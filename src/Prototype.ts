/**
 * Implementation of agora on MINA.
 *
 * There’re some limitations compared to the cardano agora:
 *
 * 1. Everything is in a single contract, meaning that contention is unavoidable.
 *    I keep it this way cause I wasn’t able to figure out how to establish trust
 *    among multiple contract instances, but we will have to figure out a better
 *    architecture.
 * 2. Each proposal can only have two outcomes, one of them is neutral.
 * 3. Each proposal can only have one effect. This is due to the fact that it’s
 *    a bit problematic to encode non-fixed-size structures in snakyjs.
 * 4. No timing control.
 * 5. Proposal cosigning is not implemented.
 * 6. Stake delegation is not implemented.
 * 7. Each stake can either create or vote for one and only one proposal.
 * 8. There's no way to actually execute an effect.
 *
 * For more info, see the cardano agora: https://github.com/liqwid-labs/agora
 */
import {
  AccountUpdate, Bool, CircuitValue, Field, Int64, MerkleTree,
  MerkleWitness, Poseidon, Provable, PublicKey, SmartContract, State, Struct,
  UInt64, method, prop, state
} from "snarkyjs";
import * as snarkyjs from "snarkyjs";

/**
 * State of the proposal finite state machine.
 */
export class ProposalStatus extends Field {
  private constructor(value: number) {
    super(value);
  }

  private static mkPredefined(value: number): ProposalStatus {
    return new ProposalStatus(value);
  }

  /**
   * Draft is the initial state of the proposal, and represents a proposal that
   * has yet to be realized.
   *
   * In effect, this means one which didn't have enough governance token to
   * be a full proposal, and needs cosigners to enable that to happen. This is
   * similar to a "temperature check", but only useful if multiple people
   * want to pool governance tokens together.
   *
   * The next valid state is Voting Ready.
   *
   * Note that cosigning is not implemented for the demo.
   */
  static get DRAFT(): ProposalStatus {
    return this.mkPredefined(0);
  }

  /**
   * The proposal has/had enough governance token cosigned in order to be a 
   * fully fledged proposal.
   *
   * This means that once the timing requirements align,
   * proposal will be able to be voted on.
   *
   * Note that the timing check is not implemented.
   */
  static get VOTING_READY(): ProposalStatus {
    return this.mkPredefined(1);
  }

  /**
   * The proposal has been voted on, and the votes have been locked
   * permanently. The proposal now goes into a locking time after the
   * normal voting time. After this, it's possible to execute the proposal.
   *
   * Note that the timing check is not implemented, and we need to figure out
   * how effects are supposed to carry out.
   */
  static get LOCKED(): ProposalStatus {
    return this.mkPredefined(2);
  }

  /**
   * The proposal has finished.
   *
   * This can mean it's been voted on and completed, but it can also mean
   * the proposal failed due to time constraints or didn't
   * get to Voting Ready first.
   */
  static get FINISHED(): ProposalStatus {
    return this.mkPredefined(3);
  }
}

export class GovernanceParameters extends CircuitValue {
  /**
   * How many governance tokens are required to transit from Draft to Voting
   * Ready.
   */
  @prop create: UInt64

  /**
   * How many votes are required for an outcome to pass.
   */
  @prop quorum: UInt64

  getHash(): Field {
    return Poseidon.hash(this.getFields());
  }

  getFields(): Field[] {
    return this.create.toFields()
      .concat(this.quorum.toFields())
  }
}

/**
 * The height of the proposal merkle tree.
 */
export const PROPOSAL_TREE_HEIGHT = 9;

const PROPOSAL_TREE_LEAF_COUNT: bigint =
  2n ** BigInt(PROPOSAL_TREE_HEIGHT - 1);

const EMPTY_PROPOSAL_TREE_LEAF: Field = new Field(0);

const EMPTY_PROPOSAL_TREE: MerkleTree = (() => {
  const tree = new MerkleTree(PROPOSAL_TREE_HEIGHT);
  tree.fill(new Array(PROPOSAL_TREE_HEIGHT).fill(EMPTY_PROPOSAL_TREE_LEAF));
  return tree;
})();

/**
 * The height of the stake merkle tree.
 */
export const STAKE_TREE_HEIGHT = 11;

const STAKE_TREE_LEAF_COUNT: bigint =
  2n ** BigInt(STAKE_TREE_HEIGHT - 1);

const EMPTY_STAKE_TREE_LEAF: Field = new Field(0);

const EMPTY_STAKE_TREE: MerkleTree = (() => {
  const tree = new MerkleTree(STAKE_TREE_HEIGHT);
  tree.fill(new Array(STAKE_TREE_HEIGHT).fill(EMPTY_STAKE_TREE_LEAF));
  return tree;
})();

export class Proposal extends Struct({
  /**
   * Identifier of the proposal. Also the index of where the proposal is stored
   * on the merkle tree.
   */
  id: Field,
  /**
   * Governance parameters copied over on initialization.
   */
  parameters: GovernanceParameters,
  /**
   * Current status of the proposal.
   */
  status: ProposalStatus,
  /**
   * Total tally for the option YES.
   */
  voteYes: UInt64,
  /**
   * Total tally for the option NO.
   */
  voteNo: UInt64,
}) {
  getHash(): Field {
    return Poseidon.hash(
      this.id.toFields()
        .concat(this.parameters.getFields())
        .concat([this.status])
        .concat(this.voteYes.toFields())
        .concat(this.voteNo.toFields())
    );
  }
}

/**
 * Store what action has been done on the proposal with the stake.
 */
export class StakeLock extends Struct({
  /**
   * If this lock in use?
   *
   * We don't have Maybe in snakyjs unfortunately.
   */
  used: Bool,
  /**
   * The identifier of the proposal.
   */
  proposalId: Field,
  /**
   * Was this stake used to create the proposal?
   *
   * The value will be false if the stake was used to vote on the proposal.
   */
  isCreator: Bool,
  /**
   * The option which was voted on, which allows votes to be retracted during
   * Voting Ready.
   */
  votedYes: Bool
}) {
  getFields(): Field[] {
    return this.used.toFields()
      .concat(this.proposalId.toFields())
      .concat(this.isCreator.toFields())
      .concat(this.votedYes.toFields());
  }
}

export class Stake extends Struct({
  /**
   * The public key this stake belongs to.
   */
  owner: PublicKey,
  /**
   * The total amount of governance token locked in this stake.
   *
   * One governance token has the weight of one in voting.
   */
  amount: UInt64,
  /**
   * Encode the proposal that lock this stake.
   *
   * If the stake is not locked, the `used` field should be false.
   */
  lockedBy: StakeLock
}) {
  getHash(): Field {
    return Poseidon.hash(
      this.owner.toFields()
        .concat(this.amount.toFields())
        .concat(this.lockedBy.getFields()));
  }
}

export class ProposalMerkleTreeWitness extends
  MerkleWitness(PROPOSAL_TREE_HEIGHT) {
}

export class StakeMerkleTreeWitness extends
  MerkleWitness(STAKE_TREE_HEIGHT) {
}

class VoteUpdates extends CircuitValue {
  @prop voteYes: UInt64;
  @prop voteNo: UInt64;
}

export class Governor extends SmartContract {
  /**
   * The hash of the governance parameters.
   *
   * The parameters are copied over to the proposal upon creation.
   */
  @state(Field) parametersHash = State<Field>();

  /**
   * The root of the merkle tree that stores all the proposals.
   */
  @state(Field) proposalTreeRoot = State<Field>();

  /**
   * The root of the merkle tree that stores all the stakes.
   */
  @state(Field) stakeTreeRoot = State<Field>();

  deployGovernor(parameters: GovernanceParameters) {
    super.deploy();

    this.parametersHash.set(parameters.getHash())
    this.proposalTreeRoot.set(EMPTY_PROPOSAL_TREE.getRoot());
    this.stakeTreeRoot.set(EMPTY_STAKE_TREE.getRoot());

    const Permissions = snarkyjs.Permissions;
    this.account.permissions.set({
      ...Permissions.default(),
      send: Permissions.proof(),
      editState: Permissions.proof(),
      receive: Permissions.proof(),
      setDelegate: Permissions.impossible(),
      setTokenSymbol: Permissions.impossible(),
      setPermissions: Permissions.impossible(),
      setVerificationKey: Permissions.impossible(),
    });
  }

  /**
   * Checks that a proposal was created lawfully, and allows it.
   *
   * @param parameters The governance parameters. Its hash should be equals to the `parametersHash` state.
   * @param stake An unlocked stake. Its staked amount should exceed the `create` threshold in the governance parameters.
   * @param stakeWitness Where we want to store the stake on the offchain merkle tree.
   * @param proposalWitness Where we store the proposal on the offchain merkle tree. The leaf should be empty.
   * @returns The updated stake, and the newly created proposal.
   */
  @method createProposal(
    parameters: GovernanceParameters,
    stake: Stake,
    stakeWitness: StakeMerkleTreeWitness,
    proposalWitness: ProposalMerkleTreeWitness
  ): [stake: Stake, proposal: Proposal] {
    parameters.getHash()
      .assertEquals(this.parametersHash.getAndAssertEquals(),
        "bad governance parameter");

    proposalWitness
      .calculateRoot(EMPTY_PROPOSAL_TREE_LEAF)
      .assertEquals(
        this.proposalTreeRoot.getAndAssertEquals(),
        "bad proposal witness: slot occupied")

    stakeWitness
      .calculateRoot(stake.getHash())
      .assertEquals(
        this.stakeTreeRoot.getAndAssertEquals(),
        "bad stake");

    stake.lockedBy.used.assertFalse("stake locked");
    stake.amount.assertGreaterThan(
      parameters.create,
      "staked amount less than minimum");

    AccountUpdate.createSigned(stake.owner).requireSignature();

    const proposalId = new Field(proposalWitness.calculateIndex());
    const proposal = new Proposal({
      id: proposalId,
      parameters: parameters,
      status: ProposalStatus.DRAFT,
      voteYes: UInt64.from(0),
      voteNo: UInt64.from(0),
    })

    const newProposalTreeRoot =
      proposalWitness.calculateRoot(proposal.getHash());
    this.proposalTreeRoot.set(newProposalTreeRoot);

    stake.lockedBy.used = new Bool(true);
    stake.lockedBy.isCreator = new Bool(true);
    stake.lockedBy.proposalId = proposalId;

    const newStakeTreeRoot =
      stakeWitness.calculateRoot(stake.getHash());
    this.stakeTreeRoot.set(newStakeTreeRoot);

    return [stake, proposal];
  }

  /**
   * Create a stake.
   *
   * @param stakeWitness Where we want to store the stake on the offchain merkle tree. The leaf should be empty.
   * @param owner The public key this stake belongs to. The corresponding private key should sign the transaction.
   * @param amount The total amount of governance token to be staked. The tokens will be sent from owner's account to this contract.
   * @returns The newly created stake.
   */
  @method createStake(
    stakeWitness: StakeMerkleTreeWitness,
    owner: PublicKey,
    amount: UInt64): Stake {
    stakeWitness
      .calculateRoot(EMPTY_STAKE_TREE_LEAF)
      .assertEquals(this.stakeTreeRoot.getAndAssertEquals(),
        "bad stake witness: slot occupied");

    const userAccountUpdate = AccountUpdate.createSigned(this.sender);
    userAccountUpdate.send({ to: this, amount: amount });
    userAccountUpdate.requireSignature();

    const stake = new Stake({
      owner: owner,
      amount: amount,
      lockedBy: new StakeLock({
        used: Bool(false),
        proposalId: Field(0),
        isCreator: Bool(false),
        votedYes: Bool(false)
      })
    })

    const newStakeTreeRoot =
      stakeWitness.calculateRoot(stake.getHash());
    this.stakeTreeRoot.set(newStakeTreeRoot);

    return stake;
  }

  /**
   * Advance proposal from Draft to Voting Ready.
   * @param proposal The proposal to be advanced.
   * @param proposalWitness Where we store the proposal on the offchain merkle tree
   * @returns The updated proposal.
   */
  @method advanceProposalFromDraft(
    proposal: Proposal,
    proposalWitness: ProposalMerkleTreeWitness,
  ): Proposal {
    proposalWitness
      .calculateRoot(proposal.getHash())
      .assertEquals(this.proposalTreeRoot.getAndAssertEquals()
        , "bad proposal");

    proposal.status.assertEquals(
      ProposalStatus.DRAFT, "proposal not in Draft");

    proposal.status = ProposalStatus.VOTING_READY;

    const newProposalTreeRoot = proposalWitness
      .calculateRoot(proposal.getHash());
    this.proposalTreeRoot.set(newProposalTreeRoot);

    return proposal;
  }

  /**
   * Advance proposal from Voting Ready to Locked.
   * @param proposal The proposal to be advanced.
   * @param proposalWitness Where we store the proposal on the offchain merkle tree
   * @returns The updated proposal.
   */
  @method advanceProposalFromVotingReady(
    proposal: Proposal,
    proposalWitness: ProposalMerkleTreeWitness,
  ): Proposal {
    proposalWitness
      .calculateRoot(proposal.getHash())
      .assertEquals(this.proposalTreeRoot.getAndAssertEquals()
        , "bad proposal");

    proposal.status.assertEquals(
      ProposalStatus.VOTING_READY
      , "proposal not in Voting Ready");

    proposal.voteNo.equals(proposal.voteYes).not()
      .and(
        proposal.voteNo.greaterThanOrEqual(proposal.parameters.quorum)
          .or(proposal.voteYes.greaterThanOrEqual(proposal.parameters.quorum)))
      .assertTrue("cannot advance from voting ready yet: ambiguous outcome");

    proposal.status = ProposalStatus.LOCKED;

    const newProposalTreeRoot = proposalWitness
      .calculateRoot(proposal.getHash());
    this.proposalTreeRoot.set(newProposalTreeRoot);

    return proposal;
  }

  /**
   * Advance proposal from Locked to Finished.
   * @param proposal The proposal to be advanced.
   * @param proposalWitness Where we store the proposal on the offchain merkle tree
   * @returns The updated proposal.
   */
  @method advanceProposalFromLocked(
    proposal: Proposal,
    proposalWitness: ProposalMerkleTreeWitness,
  ): [shouldExecute: Bool, proposal: Proposal] {
    proposalWitness
      .calculateRoot(proposal.getHash())
      .assertEquals(this.proposalTreeRoot.getAndAssertEquals()
        , "bad proposal");

    proposal.status.assertEquals(
      ProposalStatus.LOCKED,
      "proposal not in Locked");

    const shouldExecute =
      proposal.voteYes.greaterThanOrEqual(proposal.parameters.quorum)

    proposal.status = ProposalStatus.FINISHED;

    const newProposalTreeRoot = proposalWitness
      .calculateRoot(proposal.getHash());
    this.proposalTreeRoot.set(newProposalTreeRoot);

    return [shouldExecute, proposal];
  }

  /**
   * Unlock a stake, and retract the votes from the proposal if necessary.
   * @param stake The stake to be unlocked.
   * @param stakeWitness Where we store the stake on the offchain merkle tree.
   * @param proposal The proposal that locks the stake.
   * @param proposalWitness Where we store the proposal on the offchain merkle tree.
   * @returns The updated stake and proposal.
   */
  @method unlockStake(
    stake: Stake,
    stakeWitness: StakeMerkleTreeWitness,
    proposal: Proposal,
    proposalWitness: ProposalMerkleTreeWitness
  ): [stake: Stake, proposal: Proposal] {
    stakeWitness
      .calculateRoot(stake.getHash())
      .assertEquals(
        this.stakeTreeRoot.getAndAssertEquals(),
        "bad stake");

    proposalWitness
      .calculateRoot(proposal.getHash())
      .assertEquals(
        this.proposalTreeRoot.getAndAssertEquals(),
        "bad proposal");

    stake.lockedBy.used
      .and(stake.lockedBy.proposalId.equals(proposal.id))
      .assertTrue("irrelevant stake");

    AccountUpdate.createSigned(stake.owner).requireSignature();

    Provable.if(
      stake.lockedBy.isCreator,
      proposal.status.equals(ProposalStatus.FINISHED),
      new Bool(true))
      .assertTrue("proposal not finished");

    const shouldRetractVotes = stake.lockedBy.isCreator.not()
      .and(proposal.status.equals(ProposalStatus.VOTING_READY));

    const safeSub = (lhs: UInt64, rhs: UInt64): UInt64 => {
      const slhs = new Int64(lhs);
      const srhs = new Int64(rhs);
      const sres = slhs.sub(srhs);
      return Provable.if(sres.sgn.isPositive(), sres.magnitude, UInt64.zero);
    }

    const newVotes = Provable.if(
      shouldRetractVotes,
      Provable.if(
        stake.lockedBy.votedYes,
        new VoteUpdates(
          safeSub(proposal.voteYes, stake.amount),
          proposal.voteNo
        ),
        new VoteUpdates(
          proposal.voteYes,
          safeSub(proposal.voteNo, stake.amount),
        )
      ),
      new VoteUpdates(
        proposal.voteYes,
        proposal.voteNo
      )
    )

    proposal.voteYes = newVotes.voteYes;
    proposal.voteNo = newVotes.voteNo;

    stake.lockedBy.used = new Bool(false);

    const newProposalTreeRoot = proposalWitness
      .calculateRoot(proposal.getHash());
    this.proposalTreeRoot.set(newProposalTreeRoot);

    const newStakeTreeRoot = stakeWitness
      .calculateRoot(stake.getHash());
    this.stakeTreeRoot.set(newStakeTreeRoot);

    return [stake, proposal];
  }

  /**
   * Cast votes towards a particular outcome.
   * @param stake The stake used to vote. It should be unlocked.
   * @param stakeWitness Where we store the stake on the offchain merkle tree.
   * @param proposal The proposal to vote on.
   * @param proposalWitness Where we store the proposal on the offchain merkle tree.
   * @param voteYes Which outcome to vote for.
   * @returns The updated stake and proposal.
   */
  @method vote(
    stake: Stake,
    stakeWitness: StakeMerkleTreeWitness,
    proposal: Proposal,
    proposalWitness: ProposalMerkleTreeWitness,
    voteYes: Bool): [stake: Stake, proposal: Proposal] {
    stakeWitness
      .calculateRoot(stake.getHash())
      .assertEquals(
        this.stakeTreeRoot.getAndAssertEquals(),
        "bad stake");

    proposalWitness
      .calculateRoot(proposal.getHash())
      .assertEquals(
        this.proposalTreeRoot.getAndAssertEquals(),
        "bad proposal");

    stake.lockedBy.used.assertFalse("stake locked");

    AccountUpdate.createSigned(stake.owner).requireSignature();

    proposal.status.assertEquals(
      ProposalStatus.VOTING_READY,
      "can only vote in voting period");

    const newVotes =
      Provable.if(
        voteYes,
        new VoteUpdates(
          proposal.voteYes.add(stake.amount),
          proposal.voteNo
        ),
        new VoteUpdates(
          proposal.voteYes,
          proposal.voteNo.add(stake.amount),
        )
      )

    proposal.voteYes = newVotes.voteYes;
    proposal.voteNo = newVotes.voteNo;

    stake.lockedBy.used = new Bool(true);
    stake.lockedBy.isCreator = new Bool(false);
    stake.lockedBy.proposalId = proposal.id;
    stake.lockedBy.votedYes = voteYes;

    const newProposalTreeRoot = proposalWitness
      .calculateRoot(proposal.getHash());
    this.proposalTreeRoot.set(newProposalTreeRoot);

    const newStakeTreeRoot = stakeWitness
      .calculateRoot(stake.getHash());
    this.stakeTreeRoot.set(newStakeTreeRoot);

    return [stake, proposal];
  }

  /**
   * Destroy a stake and return all the locked governance tokens to the owner.
   * @param stake The stake to be destroyed.
   * @param stakeWitness Where we store the stake on the merkle tree.
   */
  @method destroyStake(
    stake: Stake,
    stakeWitness: StakeMerkleTreeWitness
  ) {
    stakeWitness
      .calculateRoot(stake.getHash())
      .assertEquals(
        this.stakeTreeRoot.getAndAssertEquals(),
        "bad stake");

    stake.lockedBy.used.assertFalse("stake locked");

    AccountUpdate.createSigned(stake.owner).requireSignature();

    this.send({ to: stake.owner, amount: stake.amount });

    const newStakeTreeRoot = stakeWitness
      .calculateRoot(EMPTY_STAKE_TREE_LEAF);
    this.stakeTreeRoot.set(newStakeTreeRoot);
  }
}
