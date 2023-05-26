const chai = require("chai");
const assert = chai.assert;
const {F1Field} = require("ffjavascript");
const path = require("path");
const { fflonkSetup } = require("../../src/fflonk/helpers/fflonk_setup.js");
const { fflonkProve } = require("../../src/fflonk/helpers/fflonk_prover.js");

const { newConstantPolsArray, newCommitPolsArray, compile, verifyPil } = require("pilcom");

const smGlobal = require("../state_machines/sm/sm_global.js");
const smConnection = require("../state_machines/sm_connection/sm_connection.js");
const { fflonkInfoGen } = require("../../src/fflonk/helpers/fflonk_info.js");
const { fflonkVerify } = require("../../src/fflonk/helpers/fflonk_verify.js");

describe("Fflonk connection sm", async function () {
    this.timeout(10000000);

   

    it("It should create the pols main", async () => {
        const F = new F1Field(21888242871839275222246405745257275088548364400416034343698204186575808495617n);

        const pil = await compile(F, path.join(__dirname, "../state_machines/", "sm_connection", "connection_main.pil"));
        const constPols =  newConstantPolsArray(pil, F);

        await smGlobal.buildConstants(constPols.Global);
        await smConnection.buildConstants(F, constPols.Connection);

        const cmPols = newCommitPolsArray(pil, F);

        await smConnection.execute(cmPols.Connection);

        const res = await verifyPil(F, pil, cmPols , constPols);

        if (res.length != 0) {
            console.log("Pil does not pass");
            for (let i=0; i<res.length; i++) {
                console.log(res[i]);
            }
            assert(0);
        }

        const ptauFile =  path.join(__dirname, "../../", "tmp", "powersOfTau28_hez_final_19.ptau");

        const fflonkInfo = fflonkInfoGen(F, pil);

        const zkey = await fflonkSetup(pil, constPols, ptauFile, fflonkInfo, {extraMuls: 2});

        const {commits, evaluations, publics} = await fflonkProve(cmPols, constPols, fflonkInfo, zkey, ptauFile, {});

        const isValid = await fflonkVerify(zkey, publics, commits, evaluations, fflonkInfo, {});
        console.log(isValid);

    });

});