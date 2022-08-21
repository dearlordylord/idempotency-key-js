import * as TE from 'fp-ts/TaskEither';
import * as IO from 'fp-ts/IO';
import { TaskEither } from 'fp-ts/TaskEither';
import * as RNA from 'fp-ts/ReadonlyNonEmptyArray';
import { absurd, flow, pipe } from 'fp-ts/function';

const NO_OP = 'noOp' as const;
const REC_POINT = 'recoveryPoint' as const;
const RESP = 'response' as const;

type NoOp = typeof NO_OP;
type RecPoint = typeof REC_POINT;
type Resp = typeof RESP;

type EffectType = NoOp | RecPoint | Resp;

enum RecPointNameBrand {_=""}
type RecPointName = string & RecPointNameBrand;

type EffectResult<T extends EffectType, R = unknown, RP extends RecPointName = RecPointName> =
  {
    type: NoOp,
  } | {
  type: RecPoint,
  name: RP;
} | {
  type: Resp,
  response: R
};

type Effect<E extends Error = Error, Tx = unknown, T extends EffectType = EffectType, R = unknown, RP extends RecPointName = RecPointName> = {
  isLocal: true; // transactional
  task: (tx: Tx) => TaskEither<E, EffectResult<T, R, RP>>;
} | {
  isLocal: false;
  task: () => TaskEither<E, EffectResult<T, R, RP>>;
}

type Config<Tx, Step extends RecPointName, E, R> = {
  startTransaction: () => Tx,
  closeTransaction: (tx: Tx) => void,
  saveRecPoint: (tx: Tx) => (s: Step) => TaskEither<E, void>,
  saveResp: (tx: Tx) => (s: R) => TaskEither<E, void>,
};

// logic to run after task is done; save rec points & responses to db
const afterTask = <Tx, E, ET extends EffectType, R, Step extends RecPointName>(config: Config<Tx, Step, E, R>) => (tx: Tx) => <ER extends EffectResult<ET, R, Step>>(e: ER): TaskEither<E, ER> => {
  switch (e.type) {
    case REC_POINT:
      return pipe(e.name, config.saveRecPoint(tx), TE.map(() => e));
    case RESP:
      return pipe(e.response, config.saveResp(tx), TE.map(() => e));
    case NO_OP:
      return TE.right(e);
    default:
      return absurd(e);
  }
};

// logic that governs how to handle transactions per effect; effects are "local" and "external" where "local" transactions should be started before effect is kicked off,
const inTransaction = <Tx, E, R, Step extends RecPointName>(config: Config<Tx, Step, E, R>) => (tx: Tx) => {
  let closed = false;
  const close = () => {if (!closed) {config.closeTransaction(tx);} closed = true; return IO.of(undefined);};
  const ffinally = <E, R>(te: TaskEither<E, R>): TaskEither<E, R> => pipe(te, TE.chainFirstIOK(close), TE.orElseFirstIOK(close));
  return {
    tryCatch: <E, R>(f: () => TaskEither<E, R>) => {
      try {
        return flow(f, ffinally)();
      } finally {
        close();
      }
    }
  };
};

// isLocal true/false differs in the moment when transaction is requested
const wireIntoLifecycle = <Tx, E extends Error, ET extends EffectType, R, Step extends RecPointName>(config: Config<Tx, Step, E, R>) => (effect: Effect<E, Tx, ET, R, Step>) => {
  const inTransactionConfigured = inTransaction(config);
  const afterTaskConfigured = afterTask(config);
  return (effect.isLocal ? flow(config.startTransaction, tx => {
    const { tryCatch } = inTransactionConfigured(tx);
    return tryCatch(() => pipe(tx, effect.task, TE.chainFirstW(afterTaskConfigured(tx))));
  }) : flow(effect.task, TE.chainW((r) => {
    const tx = config.startTransaction();
    const { tryCatch } = inTransactionConfigured(tx);
    return tryCatch(() => pipe(r, afterTaskConfigured(tx)));
  })))();
};

export const run = <Step extends RecPointName = RecPointName, E extends Error = Error, Tx = unknown, R = unknown, ET extends EffectType = EffectType>(config: Config<Tx, Step, E, R>) => (effects: RNA.ReadonlyNonEmptyArray<Effect<E, Tx, ET, R, Step>>): TaskEither<E, EffectResult<ET, R, Step>> => pipe(
  effects,
  RNA.map(wireIntoLifecycle(config)),
  RNA.map(TE.mapLeft(e => ({e, _tag: 'error'} as const))),
  // put into "Left" to contribute to stopping execution
  RNA.map(TE.chainW((e) => e.type === RESP ? TE.left({e, _tag: 'control'} as const) : TE.right(e))),
  RNA.sequence(TE.ApplicativeSeq),
  TE.map(RNA.last),
  // put back into "right" as non-error, restore status quo
  TE.orElseW(e => e._tag === 'control' ? TE.right(e.e) : TE.left(e.e))
);