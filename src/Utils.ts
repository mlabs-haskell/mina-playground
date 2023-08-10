import { OffchainStorage } from "./OffchainStorage";
import { PROPOSAL_TREE_HEIGHT, Proposal, STAKE_TREE_HEIGHT, Stake } from "./Prototype";

export function proposalStorageToJson(proposalTree: OffchainStorage<Proposal>): string {
  return JSON.stringify(
    Array.from(proposalTree.entries()).map(([k, v]) =>
      [k.toString(), v]));
}

export function stakeStorageToJson(stakeTree: OffchainStorage<Stake>): string {
  return JSON.stringify(
    Array.from(stakeTree.entries()).map(([k, v]) =>
      [k.toString(), v]));
}

export function jsonToProposalStorage(json: string): OffchainStorage<Proposal> {
  const storage = new OffchainStorage<Proposal>(PROPOSAL_TREE_HEIGHT);
  (JSON.parse(json) as Array<[string, any]>).
    forEach(([k, v]) => storage.set(BigInt(k), new Proposal(v)));
  return storage;
}

export function jsonToStakeStorage(json: string): OffchainStorage<Stake> {
  const storage = new OffchainStorage<Stake>(STAKE_TREE_HEIGHT);
  (JSON.parse(json) as Array<[string, any]>).
    forEach(([k, v]) => storage.set(BigInt(k), new Stake(v)));
  return storage;
}