import { Bool, UInt64 } from "snarkyjs";
import { command, run, number, option, flag, subcommands } from 'cmd-ts';
import {
  Proposal,
  ProposalMerkleTreeWitness,
  ProposalStatus,
  Stake,
  StakeMerkleTreeWitness
} from "../src/Prototype";
import { Env } from "./Env";

// TODO: don't hardcode this.
const configFile = "./config.json";

function bigIntMax(values: Array<bigint>): bigint {
  return values.reduce((m, e) => e > m ? e : m, BigInt(0));
}

await Env.withEnv(
  async (env) => {
    const createStake = command({
      name: 'create-stake',
      args: {
        amount: option({
          long: 'amount',
          type: number,
        }),
      },
      handler: async (args) => {
        // TODO: improve stake index allocation and avoid overflow.
        let nextStakeIndex =
          bigIntMax(Array.from(env.stakeStorage.keys())) + BigInt(1);
        const witness =
          new StakeMerkleTreeWitness(env.stakeStorage.getWitness(nextStakeIndex));
        let newStake: Stake
        await env.submitTx(
          () => {
            newStake = env.governor.createStake(
              witness,
              env.userPublicKey,
              UInt64.from(args.amount)
            );
          });
        env.stakeStorage.set(nextStakeIndex, newStake!);
        console.log("stake storage index", nextStakeIndex);
      },
    });

    const destroyStake = command({
      name: 'destroy-stake',
      args: {
        index: option({
          long: 'stake-index',
          type: number,
        }),
      },
      handler: async (args) => {
        const index = BigInt(args.index);
        const witness =
          new StakeMerkleTreeWitness(env.stakeStorage.getWitness(index));
        const stake = env.stakeStorage.get(index);
        await env.submitTx(() => {
          env.governor.destroyStake(stake!, witness);
        });
        env.stakeStorage.delete(index);
        console.log("stake destroyed");
      },
    });


    const createProposal = command({
      name: 'create-proposal',
      args: {
        stakeIndex: option({
          long: 'stake-index',
          type: number,
        }),
      },
      handler: async (args) => {
        const stakeIndex = BigInt(args.stakeIndex);
        const stake = env.stakeStorage.get(stakeIndex)!;
        const stakeWitness =
          new StakeMerkleTreeWitness(env.stakeStorage.getWitness(stakeIndex));
        const proposalIndex = bigIntMax(Array.from(env.proposalStorage.keys())) + BigInt(1);
        const proposalWitness =
          new ProposalMerkleTreeWitness(env.proposalStorage.getWitness(proposalIndex));
        let newProposal: Proposal
        let newStake: Stake
        env.submitTx(() => {
          [newStake, newProposal] =
            env.governor.createProposal(
              env.governanceParameters,
              stake,
              stakeWitness,
              proposalWitness);
        });
        env.stakeStorage.set(stakeIndex, newStake!)
        env.proposalStorage.set(proposalIndex, newProposal!);
        console.log("proposal storage index", proposalIndex);
      },
    });

    const advanceProposal = command({
      name: 'advance-proposal',
      args: {
        proposalIndex: option({
          long: 'proposal-index',
          type: number,
        }),
      },
      handler: async (args) => {
        const index = BigInt(args.proposalIndex);
        const witness =
          new ProposalMerkleTreeWitness(env.proposalStorage.getWitness(index));
        const proposal = env.proposalStorage.get(index)!;

        let newProposal: Proposal
        let shouldExecute: Bool = Bool(false);

        const txFn: () => void =
          proposal.status.equals(ProposalStatus.DRAFT).toBoolean()
            ? () => { newProposal = env.governor.advanceProposalFromDraft(proposal, witness); }
            : proposal.status.equals(ProposalStatus.VOTING_READY).toBoolean()
              ? () => { newProposal = env.governor.advanceProposalFromVotingReady(proposal, witness); }
              : proposal.status.equals(ProposalStatus.LOCKED).toBoolean()
                ? () => { [shouldExecute, newProposal] = env.governor.advanceProposalFromLocked(proposal, witness); }
                : (() => {
                  console.error("unable to advance finished proposal");
                  process.exit(1);
                })();

        env.submitTx(txFn);

        env.proposalStorage.set(index, newProposal!);

        console.log(
          shouldExecute.toBoolean() ?
            "effect executed" :
            "skip effect execution");
      },
    });

    const unlockStake = command({
      name: 'unlock-stake',
      args: {
        proposalIndex: option({
          long: 'proposal-index',
          type: number,
        }),
        stakeIndex: option({
          long: 'stake-index',
          type: number,
        }),
      },
      handler: async (args) => {
        const stakeIndex = BigInt(args.stakeIndex);
        const stake = env.stakeStorage.get(stakeIndex)!;
        const stakeWitness =
          new StakeMerkleTreeWitness(env.stakeStorage.getWitness(stakeIndex));
        const proposalIndex = BigInt(args.proposalIndex);
        const proposal = env.proposalStorage.get(proposalIndex)!;
        const proposalWitness =
          new ProposalMerkleTreeWitness(env.proposalStorage.getWitness(proposalIndex));

        let newStake: Stake
        let newProposal: Proposal

        env.submitTx(() => {
          [newStake, newProposal] =
            env.governor.unlockStake(stake, stakeWitness, proposal, proposalWitness);
        });

        env.stakeStorage.set(stakeIndex, newStake!);
        env.proposalStorage.set(proposalIndex, newProposal!);
      },
    })

    const voteWithStake = command({
      name: 'vote',
      args: {
        proposalIndex: option({
          long: 'proposal-index',
          type: number,
        }),
        stakeIndex: option({
          long: 'stake-index',
          type: number,
        }),
        voteNo: flag({
          long: 'vote-no'
        })
      },
      handler: async (args) => {
        const stakeIndex = BigInt(args.stakeIndex);
        const stake = env.stakeStorage.get(stakeIndex)!;
        const stakeWitness =
          new StakeMerkleTreeWitness(env.stakeStorage.getWitness(stakeIndex));
        const proposalIndex = BigInt(args.proposalIndex);
        const proposal = env.proposalStorage.get(proposalIndex)!;
        const proposalWitness =
          new ProposalMerkleTreeWitness(env.proposalStorage.getWitness(proposalIndex));

        let newStake: Stake
        let newProposal: Proposal

        env.submitTx(() => {
          [newStake, newProposal] =
            env.governor.vote(
              stake,
              stakeWitness,
              proposal,
              proposalWitness,
              Bool(!args.voteNo));
        });

        env.stakeStorage.set(stakeIndex, newStake!);
        env.proposalStorage.set(proposalIndex, newProposal!);
      },
    })

    const listStakes = command({
      name: 'listStakes',
      args: {
        all: flag({
          long: "all"
        })
      },
      handler: async (args) => {
        console.log(Array.from(env.stakeStorage.entries())
          .filter(([_, stake]): boolean =>
            args.all ||
            stake.owner.equals(env.userPublicKey).toBoolean()));
      }
    });

    const listProposals = command({
      name: 'listProposals',
      args: {
        all: flag({
          long: "all"
        })
      },
      handler: async (args) => {
        console.log(Array.from(env.proposalStorage.entries())
          .filter(([_, proposal]): boolean =>
            args.all ||
            proposal.status.equals(ProposalStatus.FINISHED).not().toBoolean()));
      }
    });

    const cmd = subcommands({
      name: "zkagora",
      cmds: {
        createStake,
        unlockStake,
        destroyStake,
        createProposal,
        advanceProposal,
        voteWithStake,
        listStakes,
        listProposals
      }
    });

    await run(cmd, process.argv.slice(2));
  },
  configFile);

process.exit(0);