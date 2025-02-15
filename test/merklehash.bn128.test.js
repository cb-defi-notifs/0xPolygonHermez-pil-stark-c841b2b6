const MerkleHash = require("../src/merklehash.bn128.js");
const chai = require("chai");
const assert = chai.assert;
const { buildPoseidon } = require("circomlibjs");

describe("merkle hash", async function () {
    this.timeout(10000000);
    let poseidon;
    let MH;


    before( async() => {
        poseidon = await buildPoseidon();
        MH = new MerkleHash(poseidon);
    });
    it("It should merkelize and return the right number of elements", async () => {

        const N = 256;
        const idx = 3;
        const nPols = 9;

        const pols = [];
        for (let i=0; i<nPols; i++) pols[i] = [];
        for (let i=0; i<N; i++) {
            for (let j=0; j<nPols; j++) {
                pols[j].push(BigInt(i + j*1000));
            }
        }


        const tree = await MH.merkelize(pols, 1, nPols, N);

        const [groupElements, mp] = MH.getGroupProof(tree, idx);
        const root = MH.root(tree);

        assert(MH.verifyGroupProof(root, mp, idx, groupElements));
    });
    it("It should merkelize polynomials in ext 3", async () => {
        const N = 256;
        const idx = 3;
        const nPols = 9;

        const pols = [];
        for (let i=0; i<nPols; i++) pols[i] = [];
        for (let i=0; i<N; i++) {
            for (let j=0; j<nPols; j++) {
                pols[j].push([ BigInt(i + j*1000), BigInt(i+10+j*1000), BigInt(i+20+j*1000)]);
            }
        }

        const tree = await MH.merkelize(pols, 3, nPols, N);

        const [groupElements, mp] = MH.getGroupProof(tree, idx);
        const root = MH.root(tree);

        assert(MH.verifyGroupProof(root, mp, idx, groupElements));
    });
    it("It should merkelize polynomials in ext 3", async () => {
        const N = 256;
        const idx = 3;
        const groupSize = 4;
        const nGroups = N/groupSize;


        const pol = [];
        for (let i=0; i<N; i++) {
            pol.push([ BigInt(i), BigInt(i+10), BigInt(i+20)]);
        }

        const tree = await MH.merkelize(pol, 3, groupSize, nGroups);

        const [groupElements, mp] = MH.getGroupProof(tree, idx);
        const root = MH.root(tree);

        assert(MH.verifyGroupProof(root, mp, idx, groupElements));
    });
    it("It should merkelize and return the right number of elements", async () => {

        const N = 2**14;
        const idx = 2334;
        const nPols = 40;

        const pols = [];
        for (let i=0; i<nPols; i++) pols[i] = [];
        for (let i=0; i<N; i++) {
            if (i%10000 == 0) console.log(`Building pols...${i+1}/${N}`);
            for (let j=0; j<nPols; j++) {
                pols[j].push(BigInt(i + j*1000));
            }
        }

        const tree = await MH.merkelize(pols, 1, nPols, N);

        const [groupElements, mp] = MH.getGroupProof(tree, idx);
        const root = MH.root(tree);

        assert(MH.verifyGroupProof(root, mp, idx, groupElements));
    });
});