// SPDX-License-Identifier: Apache-2.0

/*
 * Copyright 2019-2021, Offchain Labs, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *    http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

pragma solidity ^0.6.11;

import "../bridge/interfaces/IOutbox.sol";
import "../bridge/interfaces/IBridge.sol";
import "../bridge/Messages.sol";
import "../bridge/libraries/MerkleLib.sol";
import "../bridge/libraries/BytesLib.sol";
import "../bridge/libraries/Cloneable.sol";
import "@openzeppelin/contracts/utils/Address.sol";

contract OutboxWithOptTester is IOutbox, Cloneable {
    using BytesLib for bytes;
    using Address for address;
    mapping(address => InOutInfo) private allowedOutboxesMap;
    struct OutboxEntry {
        // merkle root of outputs
        bytes32 root;
        // mapping from output id => is spent
        mapping(bytes32 => bool) spentOutput;
    }
    struct InOutInfo {
        uint256 index;
        bool allowed;
    }

    event BridgeCallTriggered(
        address indexed outbox,
        address indexed destAddr,
        uint256 amount,
        bytes data
    );

    bytes1 internal constant MSG_ROOT = 0;

    uint8 internal constant SendType_sendTxToL1 = 3;

    address public rollup;
    IBridge public bridge;

    mapping(uint256 => OutboxEntry) public outboxEntries;
    address public  activeOutbox;
    struct L2ToL1Context {
        uint128 l2Block;
        uint128 l1Block;
        uint128 timestamp;
        uint128 batchNum;
        bytes32 outputId;
        address sender;
    }
    // Note, these variables are set and then wiped during a single transaction.
    // Therefore their values don't need to be maintained, and their slots will
    // be empty outside of transactions
    L2ToL1Context internal context;
    uint128 public constant OUTBOX_VERSION = 1;

    function initialize(address _rollup, IBridge _bridge) external {
        require(rollup == address(0), "ALREADY_INIT");
        bytes32 testBytes = keccak256(abi.encode(block.timestamp));
        context = L2ToL1Context({
            sender: address(this),
            l2Block: uint128(100),
            l1Block: uint128(100),
            timestamp: uint128(1643290342),
            batchNum: uint128(10),
            outputId: testBytes
        });
        rollup = _rollup;
        bridge = _bridge;
    }

    /// @notice When l2ToL1Sender returns a nonzero address, the message was originated by an L2 account
    /// When the return value is zero, that means this is a system message
    /// @dev the l2ToL1Sender behaves as the tx.origin, the msg.sender should be validated to protect against reentrancies
    function l2ToL1Sender() external view override returns (address) {
        return context.sender;
    }

    function l2ToL1Block() external view override returns (uint256) {
        return uint256(context.l2Block);
    }

    function l2ToL1EthBlock() external view override returns (uint256) {
        return uint256(context.l1Block);
    }

    function l2ToL1Timestamp() external view override returns (uint256) {
        return uint256(context.timestamp);
    }

    function l2ToL1BatchNum() external view override returns (uint256) {
        return uint256(context.batchNum);
    }

    function l2ToL1OutputId() external view override returns (bytes32) {
        return context.outputId;
    }

    function processOutgoingMessages(bytes calldata sendsData, uint256[] calldata sendLengths)
        external
        override
    {
        require(msg.sender == rollup, "ONLY_ROLLUP");
        // If we've reached here, we've already confirmed that sum(sendLengths) == sendsData.length
        uint256 messageCount = sendLengths.length;
        uint256 offset = 0;
        for (uint256 i = 0; i < messageCount; i++) {
            handleOutgoingMessage(bytes(sendsData[offset:offset + sendLengths[i]]));
            offset += sendLengths[i];
        }
    }

    function handleOutgoingMessage(bytes memory data) private {
        // Otherwise we have an unsupported message type and we skip the message
        if (data[0] == MSG_ROOT) {
            require(data.length == 97, "BAD_LENGTH");
            uint256 batchNum = data.toUint(1);
            // Ensure no outbox entry already exists w/ batch number
            require(!outboxEntryExists(batchNum), "ENTRY_ALREADY_EXISTS");

            // This is the total number of msgs included in the root, it can be used to
            // detect when all msgs were executed against a root.
            // It currently isn't stored, but instead emitted in an event for utility
            uint256 numInBatch = data.toUint(33);
            bytes32 outputRoot = data.toBytes32(65);

            OutboxEntry memory newOutboxEntry = OutboxEntry(outputRoot);
            outboxEntries[batchNum] = newOutboxEntry;
            // keeping redundant batchnum in event (batchnum and old outboxindex field) for outbox version interface compatibility
            emit OutboxEntryCreated(batchNum, batchNum, outputRoot, numInBatch);
        }
    }

    /**
     * @notice Executes a messages in an Outbox entry.
     * @dev Reverts if dispute period hasn't expired, since the outbox entry
     * is only created once the rollup confirms the respective assertion.
     * @param batchNum Index of OutboxEntry in outboxEntries array
     * @param proof Merkle proof of message inclusion in outbox entry
     * @param index Merkle path to message
     * @param l2Sender sender if original message (i.e., caller of ArbSys.sendTxToL1)
     * @param destAddr destination address for L1 contract call
     * @param l2Block l2 block number at which sendTxToL1 call was made
     * @param l1Block l1 block number at which sendTxToL1 call was made
     * @param l2Timestamp l2 Timestamp at which sendTxToL1 call was made
     * @param amount value in L1 message in wei
     * @param calldataForL1 abi-encoded L1 message data
     */
    function executeTransaction(
        uint256 batchNum,
        bytes32[] calldata proof,
        uint256 index,
        address l2Sender,
        address destAddr,
        uint256 l2Block,
        uint256 l1Block,
        uint256 l2Timestamp,
        uint256 amount,
        bytes calldata calldataForL1
    ) external virtual {
        bytes32 outputId;
        {
            bytes32 userTx = calculateItemHash(
                l2Sender,
                destAddr,
                l2Block,
                l1Block,
                l2Timestamp,
                amount,
                calldataForL1
            );

            outputId = recordOutputAsSpent(batchNum, proof, index, userTx);
            emit OutBoxTransactionExecuted(destAddr, l2Sender, batchNum, index);
        }

        // we temporarily store the previous values so the outbox can naturally
        // unwind itself when there are nested calls to `executeTransaction`
        L2ToL1Context memory prevContext = context;

        context = L2ToL1Context({
            sender: l2Sender,
            l2Block: uint128(l2Block),
            l1Block: uint128(l1Block),
            timestamp: uint128(l2Timestamp),
            batchNum: uint128(batchNum),
            outputId: outputId
        });

        // set and reset vars around execution so they remain valid during call
        executeBridgeCall(destAddr, amount, calldataForL1);

        context = prevContext;
    }

    function recordOutputAsSpent(
        uint256 batchNum,
        bytes32[] memory proof,
        uint256 path,
        bytes32 item
    ) internal returns (bytes32) {
        require(proof.length < 256, "PROOF_TOO_LONG");
        require(path < 2**proof.length, "PATH_NOT_MINIMAL");

        // Hash the leaf an extra time to prove it's a leaf
        bytes32 calcRoot = calculateMerkleRoot(proof, path, item);
        OutboxEntry storage outboxEntry = outboxEntries[batchNum];
        require(outboxEntry.root != bytes32(0), "NO_OUTBOX_ENTRY");

        // With a minimal path, the pair of path and proof length should always identify
        // a unique leaf. The path itself is not enough since the path length to different
        // leaves could potentially be different
        bytes32 uniqueKey = keccak256(abi.encodePacked(path, proof.length));

        require(!outboxEntry.spentOutput[uniqueKey], "ALREADY_SPENT");
        require(calcRoot == outboxEntry.root, "BAD_ROOT");
        require(calcRoot != 0x0 , "BAD_ROOT");
        outboxEntry.spentOutput[uniqueKey] = true;
        return uniqueKey;
    }

    function executeCall(
        address destAddr,
        uint256 amount,
        bytes memory data
    ) public  returns (bool success, bytes memory returnData) {
        //require(allowedOutboxesMap[msg.sender].allowed, "NOT_FROM_OUTBOX");
        if (data.length > 0) require(destAddr.isContract(), "NO_CODE_AT_DEST");
        address currentOutbox = activeOutbox;
        activeOutbox = msg.sender;
        // We set and reset active outbox around external call so activeOutbox remains valid during call
        (success, returnData) = destAddr.call{ value: amount }(data);
        activeOutbox = currentOutbox;
        emit BridgeCallTriggered(msg.sender, destAddr, amount, data);
    }

    function setEntry(uint256 id, bytes32 data) public {
        OutboxEntry storage entry = outboxEntries[id];
        entry.root = data;
    }

    function executeBridgeCall(
        address destAddr,
        uint256 amount,
        bytes memory data
    ) internal {
        (bool success, bytes memory returndata) = bridge.executeCall(destAddr, amount, data);
        if (!success) {
            if (returndata.length > 0) {
                // solhint-disable-next-line no-inline-assembly
                assembly {
                    let returndata_size := mload(returndata)
                    revert(add(32, returndata), returndata_size)
                }
            } else {
                revert("BRIDGE_CALL_FAILED");
            }
        }
    }

    function calculateItemHash(
        address l2Sender,
        address destAddr,
        uint256 l2Block,
        uint256 l1Block,
        uint256 l2Timestamp,
        uint256 amount,
        bytes calldata calldataForL1
    ) public pure returns (bytes32) {
        return
            keccak256(
                abi.encodePacked(
                    SendType_sendTxToL1,
                    uint256(uint160(bytes20(l2Sender))),
                    uint256(uint160(bytes20(destAddr))),
                    l2Block,
                    l1Block,
                    l2Timestamp,
                    amount,
                    calldataForL1
                )
            );
    }

    function calculateMerkleRoot(
        bytes32[] memory proof,
        uint256 path,
        bytes32 item
    ) public pure returns (bytes32) {
        return MerkleLib.calculateRoot(proof, path, keccak256(abi.encodePacked(item)));
    }

    function outboxEntryExists(uint256 batchNum) public view override returns (bool) {
        return outboxEntries[batchNum].root != bytes32(0);
    }

    fallback() payable external{

    }
}
