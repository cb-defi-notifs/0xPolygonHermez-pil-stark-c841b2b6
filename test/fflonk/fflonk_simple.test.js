const chai = require("chai");
const assert = chai.assert;
const {F1Field, buildBn128} = require("ffjavascript");
const path = require("path");
const fflonkSetup  = require("../../src/fflonk/helpers/fflonk_setup.js");
const fflonkProve = require("../../src/fflonk/helpers/fflonk_prover.js");
const fflonkInfoGen  = require("../../src/fflonk/helpers/fflonk_info.js");
const fflonkVerify  = require("../../src/fflonk/helpers/fflonk_verify.js");
const fflonkVerificationKey = require("../../src/fflonk/helpers/fflonk_verification_key.js");
const { readPilFflonkZkeyFile } = require("../../src/fflonk/zkey/zkey_pilfflonk.js");

const { newConstantPolsArray, newCommitPolsArray, compile, verifyPil } = require("pilcom");

const smSimple = require("../state_machines/sm_simple/sm_simple.js");

const Logger = require("logplease");
const { writeConstPolsFile, readConstPolsFile } = require("../../src/fflonk/const_pols_serializer.js");

const logger = Logger.create("pil-fflonk", {showTimestamp: false});
Logger.setLogLevel("DEBUG");

describe("simple sm", async function () {
    this.timeout(10000000);

    it("Simple1", async () => {
        await runTest("simple1");
    });
    it("Simple2", async () => {
        await runTest("simple2");
    });
    it("Simple2p", async () => {
        await runTest("simple2p");
    });
    it("Simple3", async () => {
        await runTest("simple3");
    });
    it.only("Simple4", async () => {
        await runTest("simple4");
    });
    it("Simple4p", async () => {
        await runTest("simple4p");
    });

    async function runTest(pilFile) {
        const logger = Logger.create("pil-fflonk", {showTimestamp: false});
        Logger.setLogLevel("DEBUG");

        const F = new F1Field(21888242871839275222246405745257275088548364400416034343698204186575808495617n);
    
        const pil = await compile(F, path.join(__dirname, "../state_machines/", "sm_simple", `${pilFile}.pil`));
        const constPols =  newConstantPolsArray(pil, F);
    
        await smSimple.buildConstants(constPols.Simple);
    
        const cmPols = newCommitPolsArray(pil, F);
    
        const isArray = pilFile === "simple2p" ? true : false;
        await smSimple.execute(F, cmPols.Simple, isArray);
    
        const res = await verifyPil(F, pil, cmPols , constPols);
    
        if (res.length != 0) {
            console.log("Pil does not pass");
            for (let i=0; i<res.length; i++) {
                console.log(res[i]);
            }
            assert(0);
        }
    
        const ptauFile =  path.join(__dirname, "../../", "tmp", "powersOfTau28_hez_final_19.ptau");
        const zkeyFilename =  path.join(__dirname, "../../", "tmp", `fflonk_${pilFile}.zkey`);

        const fflonkInfo = fflonkInfoGen(F, pil);

        const {constPolsCoefs, constPolsEvals, constPolsEvalsExt} = await fflonkSetup(pil, constPols, zkeyFilename, ptauFile, fflonkInfo, {extraMuls: 1, logger});
    
        // TODO remove
        curve = await buildBn128();
        const constPolsFilename =  path.join(__dirname, "../../", "tmp", "simple_pols.const");
        await writeConstPolsFile(constPolsFilename, constPolsCoefs, constPolsEvals, constPolsEvalsExt, curve.Fr, {logger});

        const xxx = await readConstPolsFile(constPolsFilename, curve.Fr, {logger});

        const zkey = await readPilFflonkZkeyFile(zkeyFilename, {logger});

        const vk = await fflonkVerificationKey(zkey, {logger});

        //const {proof, publicSignals} = await fflonkProve(zkey, cmPols, xxx.evals, xxx.coefs, xxx.evalsExt, fflonkInfo, {logger});
        const {proof, publicSignals} = await fflonkProve(zkey, cmPols, constPolsEvals, constPolsCoefs, constPolsEvalsExt, fflonkInfo, {logger});

        const isValid = await fflonkVerify(vk, publicSignals, proof, fflonkInfo, {logger});
        assert(isValid);
    }
});
