const { expect } = require("chai");
const { Contract } = require("ethers");
const { ethers,hre } = require("hardhat");
const TestCase = require("./Outbox_testcase.json")
async function sendEth(send_account, to_address, send_token_amount) {
    const nonce = await ethers.provider.getTransactionCount(send_account, "latest");
    const gas_price = await ethers.provider.getGasPrice();
    
    const tx = {
      from: send_account,
      to: to_address,
      value: send_token_amount,
      nonce: nonce,
      gasLimit: 100000, // 100000
      gasPrice: gas_price,
    }
    const signer = ethers.provider.getSigner(send_account);
    await signer.sendTransaction(tx);

}

async function getTokenTransferData(to_address, send_token_amount, erc20) {
    const iface = erc20.interface;
    return iface.encodeFunctionData("transfer", [to_address, send_token_amount]);
}

async function setEntries(cases, outbox) {
    let batchNumMap = new Map();
    const length = cases.length;
    for(let i = 0; i < length; i++) {
        if(!batchNumMap.has(cases[i].batchNum)) {
            batchNumMap.set(cases[i].batchNum, cases[i].root);
            await outbox.setEntry(cases[i].batchNum, cases[i].root);
        }
    }  
}

describe("Outbox", async function () {
    let outboxWithOpt;
    let outboxWithoutOpt;
    let token;
    let bridge;
    const cases = TestCase.cases;
    const sentEthAmount = ethers.utils.parseEther("10");
    
    before(async function () {
        const accounts = await ethers.getSigners();
        const OutboxWithOpt = await ethers.getContractFactory("OutboxWithOptTester");
        const OutboxWithoutOpt = await ethers.getContractFactory("OutboxWithoutOptTester");
        const Token = await ethers.getContractFactory("TestToken");
        const Bridge = await ethers.getContractFactory("Bridge");
        token = await Token.deploy("Test token", "tst");
        outboxWithOpt = await OutboxWithOpt.deploy();
        outboxWithoutOpt = await OutboxWithoutOpt.deploy();
        bridge = await Bridge.deploy();
        // await outboxWithOpt.deployed();
        // await outboxWithoutOpt.deployed();
        const balance = await token.balanceOf("0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266");
        
        await outboxWithOpt.initialize("0xC12BA48c781F6e392B49Db2E25Cd0c28cD77531A", bridge.address);
        await outboxWithoutOpt.initialize("0xC12BA48c781F6e392B49Db2E25Cd0c28cD77531A", bridge.address);

        await bridge.setOutbox(outboxWithOpt.address, true);
        await bridge.setOutbox(outboxWithoutOpt.address, true);

        await setEntries(cases, outboxWithOpt);
        await setEntries(cases, outboxWithoutOpt);

        await sendEth(accounts[0].address, bridge.address, sentEthAmount);
        
        
    })
    it("First call to initial some storage", async function () {    
        expect(await outboxWithOpt.executeTransaction(cases[0].args.batchNum, cases[0].args.proof, cases[0].args.index, cases[0].args.l2Sender, cases[0].args.destAddr, cases[0].args.l2Block, cases[0].args.l1Block, cases[0].args.l2Timestamp, cases[0].args.amount, cases[0].args.calldataForL1)).to.emit("BridgeCallTriggered")
        expect(await outboxWithoutOpt.executeTransaction(cases[0].args.batchNum, cases[0].args.proof, cases[0].args.index, cases[0].args.l2Sender, cases[0].args.destAddr, cases[0].args.l2Block, cases[0].args.l1Block, cases[0].args.l2Timestamp, cases[0].args.amount, cases[0].args.calldataForL1)).to.emit("BridgeCallTriggered")
        
    });
    
    it("Call twice without storage initail cost", async function () {
        expect(await outboxWithOpt.executeTransaction(cases[1].args.batchNum, cases[1].args.proof, cases[1].args.index, cases[1].args.l2Sender, cases[1].args.destAddr, cases[1].args.l2Block, cases[1].args.l1Block, cases[1].args.l2Timestamp, cases[1].args.amount, cases[1].args.calldataForL1)).to.emit("BridgeCallTriggered")
        expect(await outboxWithoutOpt.executeTransaction(cases[1].args.batchNum, cases[1].args.proof, cases[1].args.index, cases[1].args.l2Sender, cases[1].args.destAddr, cases[1].args.l2Block, cases[1].args.l1Block, cases[1].args.l2Timestamp, cases[1].args.amount, cases[1].args.calldataForL1)).to.emit("BridgeCallTriggered")
        
    });

    it("should revert when use redo the same tx", async function () {
        await expect( outboxWithOpt.executeTransaction(cases[0].args.batchNum, cases[0].args.proof, cases[0].args.index, cases[0].args.l2Sender, cases[0].args.destAddr, cases[0].args.l2Block, cases[0].args.l1Block, cases[0].args.l2Timestamp, cases[0].args.amount, cases[0].args.calldataForL1)).to.be.revertedWith("ALREADY_SPENT")
        await expect( outboxWithoutOpt.executeTransaction(cases[0].args.batchNum, cases[0].args.proof, cases[0].args.index, cases[0].args.l2Sender, cases[0].args.destAddr, cases[0].args.l2Block, cases[0].args.l1Block, cases[0].args.l2Timestamp, cases[0].args.amount, cases[0].args.calldataForL1)).to.be.revertedWith("ALREADY_SPENT")
        
    });

    
    
  });
  
