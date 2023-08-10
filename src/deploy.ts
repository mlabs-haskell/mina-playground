import { AccountUpdate, Bool, Mina, PrivateKey, PublicKey, UInt64 } from "snarkyjs";
import { command, run, number, option, flag, subcommands } from 'cmd-ts';
import fs from 'fs/promises';
import { jsonToProposalStorage, jsonToStakeStorage, proposalStorageToJson, stakeStorageToJson } from "./Utils";
import { GovernanceParameters, Governor, Proposal, ProposalMerkleTreeWitness, ProposalStatus, STAKE_TREE_HEIGHT, Stake, StakeMerkleTreeWitness } from "./Prototype";
import { FeePayerSpec } from "snarkyjs/dist/node/lib/mina";
import { OffchainStorage } from "./OffchainStorage";

type Config = {
  networkUrl: string,
  fee: string,
  governorPublicKey: string,
  stakeStoragePath: string,
  proposalStoragePath: string,
  userKeyPath: string
};

const configPath = 'config.json';
let config: Config = JSON.parse(await fs.readFile(configPath, 'utf8'));

const Network = Mina.Network(config.networkUrl);
Mina.setActiveInstance(Network);
await Governor.compile();

const userKeyBase58: { privateKey: string; publicKey: string } =
  JSON.parse(await fs.readFile(config.userKeyPath, 'utf8'));
const userPrivateKey = PrivateKey.fromBase58(userKeyBase58.privateKey);
const userPublicKey = PublicKey.fromBase58(userKeyBase58.publicKey);

const stakeStorage = new OffchainStorage<Stake>(STAKE_TREE_HEIGHT);
const proposalStorage = new OffchainStorage<Proposal>(STAKE_TREE_HEIGHT);

const governanceParameters = new GovernanceParameters(
  {
    create: UInt64.from(100),
    quorum: UInt64.from(100_000)
  }
);

const feePayerSpec: FeePayerSpec = {
  sender: userPublicKey,
  fee: Number(config.fee) * 1e9
};

const governorPrivateKey = PrivateKey.random();
const governorPublicKey = governorPrivateKey.toPublicKey();

config.governorPublicKey = governorPublicKey.toBase58();

const governor = new Governor(governorPublicKey);

const txn = await Mina.transaction(feePayerSpec, () => {
  AccountUpdate.fundNewAccount(feePayerSpec.sender);
  governor.deployGovernor(governanceParameters);
});

await txn.prove();
await txn.sign([userPrivateKey, governorPrivateKey]).send();

await fs.writeFile(config.stakeStoragePath, stakeStorageToJson(stakeStorage));
await fs.writeFile(config.proposalStoragePath, proposalStorageToJson(proposalStorage));
await fs.writeFile(configPath, JSON.stringify(config));