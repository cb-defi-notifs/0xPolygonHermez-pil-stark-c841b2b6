const fs = require("fs");
const version = require("../../package").version;

const F3g = require("../helpers/f3g.js");
const {readR1cs} = require("r1csfile");
const plonkSetupC18 = require("./compressor18_setup.js");
const plonkSetupC12 = require("./compressor12_setup.js");
const plonkSetupC132 = require("./compressor132_setup.js");


const argv = require("yargs")
    .version(version)
    .usage("node main_compressor_setup.js -r <verifier.c12.r1cs> -p <verifier.c12.pil> -c <verifier.c12.const> -e <verifier.c12.exec> [--forceNBits=23]")
    .alias("r", "r1cs")
    .alias("c", "const")  // Output file required to build the constants
    .alias("p", "pil")    // Proposed PIL
    .alias("e", "exec")   // File required to execute
    .string("cols")
    .argv;

async function run() {
    const F = new F3g();

    const r1csFile = typeof(argv.r1cs) === "string" ?  argv.r1cs.trim() : "mycircuit.verifier.r1cs";
    const constFile = typeof(argv.const) === "string" ?  argv.const.trim() : "mycircuit.c12.const";
    const pilFile = typeof(argv.pil) === "string" ?  argv.pil.trim() : "mycircuit.c12.pil";
    const execFile = typeof(argv.exec) === "string" ?  argv.exec.trim() : "mycircuit.c12.exec";

    const r1cs = await readR1cs(r1csFile, {F: F, logger:console });

    const options = {
        forceNBits: argv.forceNBits
    };

    let cols = argv.cols ? Number(argv.cols) : 12;
    
    if(![12,18].includes(cols)) throw new Error("Invalid number of cols");

    let res;
    if(cols === 12) {
        res = await plonkSetupC132(F, r1cs, options);
    } else {
        res = await plonkSetupC18(F, r1cs, options);
    }

    await fs.promises.writeFile(pilFile, res.pilStr, "utf8");

    await res.constPols.saveToFile(constFile);

    await writeExecFile(execFile,res.plonkAdditions, res.sMap);

    console.log("files Generated Correctly");

}

run().then(()=> {
    process.exit(0);
}, (err) => {
    console.log(err.message);
    console.log(err.stack);
    process.exit(1);
});


async function writeExecFile(execFile, adds, sMap) {

    const size = 2 + adds.length*4 + sMap.length*sMap[0].length;
    const buff = new BigUint64Array(size);

    buff[0] = BigInt(adds.length);
    buff[1] = BigInt(sMap[0].length);

    for (let i=0; i< adds.length; i++) {
        buff[2 + i*4     ] = BigInt(adds[i][0]);
        buff[2 + i*4 + 1 ] = BigInt(adds[i][1]);
        buff[2 + i*4 + 2 ] = adds[i][2];
        buff[2 + i*4 + 3 ] = adds[i][3];
    }

    for (let i=0; i<sMap[0].length; i++) {
        for (let c=0; c<sMap.length; c++) {
            buff[2 + adds.length*4 + sMap.length*i + c] = BigInt(sMap[c][i]);
        }
    }

    const fd =await fs.promises.open(execFile, "w+");
    await fd.write(buff);
    await fd.close();

}
