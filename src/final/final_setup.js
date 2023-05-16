const { assert } = require("chai");
const fs = require("fs");
const path = require("path");
const { log2 } = require("pilcom/src/utils.js");
const {tmpName} = require("tmp-promise");
const { newConstantPolsArray, compile, getKs } = require("pilcom");
const ejs = require("ejs");
const r1cs2plonk = require("../r1cs2plonk");
const { C, M } = require("./poseidon_constants.js");
const { getCustomGatesInfo, calculatePlonkConstraints } = require("./final_helpers.js");

module.exports = async function plonkSetup(F, r1cs, options) {
    // Calculate the number plonk Additions and plonk constraints from the R1CS
    const [plonkConstraints, plonkAdditions] = r1cs2plonk(F, r1cs);

    const addRangeChecks = true;

    const nPlonk = 2;

    const nCommittedPols = 8;

    if(nPlonk * 3 > nCommittedPols) throw new Error("This is not possible");
    
    // Calculate how many C12 constraints are needed 
    const CPlonkConstraints = calculatePlonkConstraints(plonkConstraints, nPlonk);

    // Get information about the custom gates from the R1CS
    const customGatesInfo = getCustomGatesInfo(r1cs);

    // Calculate the total number of publics used in PIL and how many rows are needed to store all of them
    let nPublics = r1cs.nOutputs + r1cs.nPubInputs;
    const nPublicRows = Math.floor((nPublics - 1)/nCommittedPols) + 1; 

    const N_ROUNDS_P = [56, 57, 56, 60, 60, 63, 64, 63, 60, 66, 60, 65, 70, 60, 64, 68];

    const nRoundsF = 8;
    const nRoundsP = N_ROUNDS_P[customGatesInfo.nPoseidonInputs - 2]; 

    const nRoundsPoseidon = nRoundsF + nRoundsP;

    const poseidonRows = customGatesInfo.nPoseidonT*(nRoundsPoseidon + 1);

    let nRangeChecks = customGatesInfo.nRangeCheck;
    if(addRangeChecks) {
        const rangeChecksSlotsPlonk = (nCommittedPols - 3*nPlonk)*CPlonkConstraints; 
        console.log("Number of range checks in plonk rows ->", rangeChecksSlotsPlonk);
        nRangeChecks -= rangeChecksSlotsPlonk;

        const rangeChecksSlotsPoseidon = (nCommittedPols - 5)*poseidonRows; 
        console.log("Number of range checks in Poseidon rows ->", rangeChecksSlotsPoseidon);
        nRangeChecks -= rangeChecksSlotsPoseidon;
    } 
    const rangeChecksRows = Math.ceil(nRangeChecks / nCommittedPols);

    console.log(`Number of Plonk constraints: ${plonkConstraints.length} -> Number of plonk per row: ${nPlonk} -> Constraints:  ${CPlonkConstraints}`);
    console.log(`Number of Plonk additions: ${plonkAdditions.length}`);
    console.log(`Number of publics: ${nPublics} -> Constraints: ${nPublicRows}`);
    console.log(`Number of PoseidonT with ${customGatesInfo.nPoseidonInputs}: ${customGatesInfo.nPoseidonT} -> Number of rows: ${poseidonRows}`);
    console.log(`Number of RangeChecks: ${customGatesInfo.nRangeCheck} -> Number of rows: ${rangeChecksRows}`);

    const NUsed = nPublicRows + CPlonkConstraints + poseidonRows + rangeChecksRows;
    
    //Calculate the first power of 2 that's bigger than the number of constraints
    let nBits = log2(NUsed - 1) + 1;

    if (options.forceNBits) {
        if (options.forceNBits < nBits) {
            throw new Error("ForceNBits is less than required");
        }
        nBits = options.forceNBits;
    }
    const N = 1 << nBits; // First power of 2 whose value is higher than the number of constraints

    console.log(`NUsed: ${NUsed}`);
    console.log(`nBits: ${nBits}, 2^nBits: ${N}`);

    const template = await fs.promises.readFile(path.join(__dirname, "final.pil.ejs"), "utf8");
    const obj = {
        N,
        NUsed,
        nBits,
        nPublics,
        M: M[customGatesInfo.nPoseidonInputs - 1],
        nInPoseidon: customGatesInfo.nPoseidonInputs,
        nPlonk,
        nCommittedPols,
        addRangeChecks,
    };

    const pilStr = ejs.render(template ,  obj);
    const pilFile = await tmpName();
    await fs.promises.writeFile(pilFile, pilStr, "utf8");
    const pil = await compile(F, pilFile);
    const constPols =  newConstantPolsArray(pil, F);

    fs.promises.unlink(pilFile);

    // Stores the positions of all the values that each of the committed polynomials takes in each row 
    // Remember that there are 5 committed polynomials and the number of rows is stored in NUsed
    const sMap = [];
    for (let i=0;i<nCommittedPols; i++) {
        sMap[i] = new Uint32Array(N);
    }

    // Paste public inputs. All constant polynomials are set to 0
    for (let i=0; i<nPublicRows; i++) {
        constPols.Final.GATE[i] = 0n;
        constPols.Final.POSEIDON_T[i] = 0n;
        constPols.Final.PARTIAL[i] = 0n;
        constPols.Final.RANGE_CHECK[i] = 0n;
        for (let k=0; k<5; k++) {
            constPols.Final.C[k][i] = 0n;
        }
    }

    // Store the public inputs position in the mapping sMap
    for (let i=0; i<nPublicRows*nCommittedPols; i++) {
        // Since each row contains 6 public inputs, it is possible that
        // the last row is partially empty. Therefore, fulfill that last row
        // with 0.
        if(i < nPublics) {
            sMap[i%nCommittedPols][Math.floor(i/nCommittedPols)] = 1+i;
        } else {
            sMap[i%nCommittedPols][Math.floor(i/nCommittedPols)] = 0;
        }
    }

    let r = nPublicRows;

    let partialRowRC = [];

    // Paste plonk constraints. 
    const partialRows = {}; // Stores a row that is partially completed, which means that a we only have one set of wires (a_i, b_i, c_i) that fulfill a given constraint
    for (let i=0; i<plonkConstraints.length; i++) {
        if ((i%10000) == 0) console.log(`Point check -> Processing constraint... ${i}/${plonkConstraints.length}`);
        const c = plonkConstraints[i];
        const k= c.slice(3, 8).map( a=> a.toString(16)).join(",");
        // Once a new constraint is read, check if there's some partial row with that constraint. If that's the case, add the wire (which is stored in [c0, c1, c2]) to 
        // the corresponding row

        if (partialRows[k]) {
            const pr = partialRows[k];
            sMap[pr.nUsed*3][pr.row] = c[0];
            sMap[pr.nUsed*3+1][pr.row] = c[1];
            sMap[pr.nUsed*3+2][pr.row] = c[2];
            pr.nUsed ++;
            // If nUsed is equal to 2, it means the first set of constraints values is being fulfilled and the second half needs still to be added.
            // Otherwise the C12 row is full
            if (pr.nUsed == nPlonk) {
                delete partialRows[k];
            } 
        // If the constraint is not stored in partialRows (which means that there is no other row that is using this very same set of constraints and is not full)
        // check if there's any half row. If that's the case, attach the new set of constraints values to that row 
        } else {
            constPols.Final.GATE[r] = 1n;
            constPols.Final.PARTIAL[r] = 0n;
            constPols.Final.POSEIDON_T[r] = 0n;
            constPols.Final.RANGE_CHECK[r] = 0n;
            for(let i = 0; i < nPlonk; i++) {
                sMap[3*i][r] = c[0];
                sMap[3*i+1][r] = c[1];
                sMap[3*i+2][r] = c[2];
            }
            for(let k = 3*nPlonk; k < nCommittedPols; k++) {
                sMap[k][r] = 0;
            }

            if(addRangeChecks && nCommittedPols - nPlonk * 3 !== 0) {
                partialRowRC.push({row: r, index: nPlonk * 3});
            }

            constPols.Final.C[0][r] = c[3];
            constPols.Final.C[1][r] = c[4];
            constPols.Final.C[2][r] = c[5];
            constPols.Final.C[3][r] = c[6];
            constPols.Final.C[4][r] = c[7];
            if(nPlonk > 1) {
                partialRows[k] = {
                    row: r,
                    nUsed: 1
                };
            }
            r++;
        }
    }

    // Generate Custom Gates
    
    for(let i = 0; i < r1cs.customGatesUses.length; i++) {
        if (r1cs.customGatesUses[i].id !== customGatesInfo.PoseidonT) continue;
        if ((i%10000) == 0) console.log(`Point check -> Processing Poseidon custom gates... ${i}/${r1cs.customGatesUses.length}`);
        const cgu = r1cs.customGatesUses[i];
        assert(cgu.signals.length == (nRoundsPoseidon+1)*customGatesInfo.nPoseidonInputs);
        // First 30 rows store the each one of the rounds, while the last one only stores the output hash value so
        // that it can be checked.
        // All constant polynomials are set to 0 except for C, which contains the GL Poseidon constants, 
        // POSEIDON16, which is always 1, and PARTIAL, which is 1 in the first and last for rounds and zero otherwise
        for (let k=0; k<nRoundsPoseidon + 1; k++) {
            for (let j=0; j<5; j++) {
                sMap[j][r+k] = cgu.signals[k*customGatesInfo.nPoseidonInputs+j];
                constPols.Final.C[j][r+k] = k < nRoundsPoseidon ? BigInt(C[customGatesInfo.nPoseidonInputs - 1][k*customGatesInfo.nPoseidonInputs+j]) : 0n;
            }
            for(let l = 5; l < nCommittedPols; l++) {
                sMap[l][r+k] = 0;
            }
            if(addRangeChecks) {
                partialRowRC.push({row: r+k, index: 5});
            }
            constPols.Final.GATE[r+k] = 0n;
            constPols.Final.POSEIDON_T[r+k] = k < nRoundsPoseidon ? 1n: 0n;
            constPols.Final.PARTIAL[r+k] = k < nRoundsPoseidon ? ((k<4)||(k>=nRoundsP + 4) ? 0n : 1n) : 0n;
            constPols.Final.RANGE_CHECK[r+k] = 0n;
        }
        r+=nRoundsPoseidon + 1;
    }

    for(let i = 0; i < r1cs.customGatesUses.length; i++) {
        if (r1cs.customGatesUses[i].id !== customGatesInfo.RangeCheck) continue;
        if ((i%10000) == 0) console.log(`Point check -> Processing Range Check custom gates... ${i}/${r1cs.customGatesUses.length}`);
        const cgu = r1cs.customGatesUses[i];
        if(partialRowRC.length > 0) {
            const row = partialRowRC[0].row;
            sMap[partialRowRC[0].index++][row] = cgu.signals[0];
            if(partialRowRC[0].index === nCommittedPols) {
                partialRowRC.shift();
            }
        } else {
            constPols.Final.GATE[r] = 0n;
            constPols.Final.POSEIDON_T[r] = 0n;
            constPols.Final.PARTIAL[r] = 0n;
            constPols.Final.RANGE_CHECK[r] = 1n;
            for (let k=0; k<5; k++) {
                constPols.Final.C[k][r] = 0n;
            }
            sMap[0][r] = cgu.signals[0];
            for(let j = 1; j < nCommittedPols; ++j) {
                sMap[j][r] = 0;
            }
            partialRowRC.push({row: r, index: 1});
            r += 1;
        } 
    }

    const ks = getKs(F, nCommittedPols - 1);
    let w = F.one;
    for (let i=0; i<N; i++) {
        if ((i%10000) == 0) console.log(`Point check -> Preparing S... ${i}/${N}`);
        constPols.Final.S[0][i] = w;
        for (let j=1; j<nCommittedPols; j++) {
            constPols.Final.S[j][i] = F.mul(w, ks[j-1]);
        }
        w = F.mul(w, F.w[nBits]);
    }

    const lastSignal = {}
    for (let i=0; i<r; i++) {
        if ((i%10000) == 0) console.log(`Point check -> Connection S... ${i}/${r}`);
        for (let j=0; j<nCommittedPols; j++) {
            if (sMap[j][i]) {
                if (typeof lastSignal[sMap[j][i]] !== "undefined") {
                    const ls = lastSignal[sMap[j][i]];
                    connect(constPols.Final.S[ls.col][ls.row], constPols.Final.S[j][i]);
                } else {
                    lastSignal[sMap[j][i]] = {
                        col: j,
                        row: i
                    };
                }
            }
        }
    }
    
    // Fill unused rows (NUsed < r < N) with empty gates
    while (r < N) {
        if ((r%100000) == 0) console.log(`Point check -> Empty gates... ${r}/${N}`);
        constPols.Final.GATE[r] = 0n;
        constPols.Final.POSEIDON_T[r] = 0n;
        constPols.Final.PARTIAL[r] = 0n;
        constPols.Final.RANGE_CHECK[r] = 0n;
        for (let k=0; k<5; k++) {
            constPols.Final.C[k][r] = 0n;
        }
        r +=1;
    }

    // Calculate the Lagrangian Polynomials for the public rows
    // Its value is 1 on the i^th row and 0 otherwise
    for (let i=0; i<nPublicRows; i++) {
        const L = constPols.Global["L" + (i+1)];
        for (let i=0; i<N; i++) {
            L[i] = 0n;
        }
        L[i] = 1n;
    }


    return {
        pilStr: pilStr,
        constPols: constPols,
        sMap: sMap,
        plonkAdditions: plonkAdditions,
    };

    function connect(p1, p2) {
        [p1, p2] = [p2, p1];
    }
}
