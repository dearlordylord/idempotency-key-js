import * as TE from 'fp-ts/TaskEither';
import * as IO from 'fp-ts/IO';
import { TaskEither } from 'fp-ts/TaskEither';
import * as RNA from 'fp-ts/ReadonlyNonEmptyArray';
import * as RA from 'fp-ts/ReadonlyArray';
import { absurd, flow, pipe } from 'fp-ts/function';
import { Option } from 'fp-ts/Option';
import * as O from 'fp-ts/Option';
import { identity } from 'fp-ts/function';

export const NO_OP = 'noOp' as const;
export const REC_POINT = 'recoveryPoint' as const;
export const RESP = 'response' as const;

export type NoOp = typeof NO_OP;
export type RecPoint = typeof REC_POINT;
export type Resp = typeof RESP;

export type EffectType = NoOp | RecPoint | Resp;

export enum RecPointNameBrand {
  _ = '',
}
export type RecPointCustomName = string & RecPointNameBrand;

type EffectResult<T extends EffectType, R = unknown, RP extends RecPointCustomName = RecPointCustomName> =
  | {
      // TODO implement passing result to next effect
      type: NoOp;
    }
  | {
      // TODO implement passing result to next effect
      type: RecPoint;
    }
  | {
      type: Resp;
      response: R;
    };

type Effect<
  E extends Error = Error,
  Tx = unknown,
  T extends EffectType = EffectType,
  R = unknown,
  RP extends RecPointCustomName = RecPointCustomName,
  Args = unknown
> = { name: RP } & (
  | {
      isLocal: true; // transactional
      task: (ctx: {
        args: Args;
        key: Key;
      }) => (tx: Tx /*TODO prev effect result*/) => TaskEither<E, EffectResult<T, R, RP>>;
    }
  | {
      isLocal: false;
      task: (ctx: { args: Args; key: Key }) => (/*TODO prev effect result*/) => TaskEither<E, EffectResult<T, R, RP>>;
    }
);

type Key = string; // todo configurable

type IdempotencyKeyDbResult<
  Step extends RecPointCustomName,
  FirstStep extends string,
  FinalStep extends string,
  R,
  Args = any,
  RStep extends Step | FirstStep | FinalStep = Step | FirstStep | FinalStep
> = {
  key: Key;
  step: RStep;
  args?: Args; // TODO type // TODO compile time check
  response?: R; // TODO compile time check
  // TODO locked_at?
};

export type Config<
  Tx,
  Step extends RecPointCustomName,
  FirstStep extends string,
  FinalStep extends string,
  E extends Error,
  R,
  Args = any
> = {
  getIdempotencyKey: (tx: Tx) => TaskEither<E, Option<IdempotencyKeyDbResult<Step, FirstStep, FinalStep, R, Args>>>;
  argsEqual: (args1: Args, args2: Args) => boolean;
  refreshIdempotencyKey: (tx: Tx, k: Key) => TaskEither<E, void>;
  createIdempotencyKey: (tx: Tx) => TaskEither<E, Key>;
  startTransaction: () => Tx;
  closeTransaction: (tx: Tx) => void;
  saveRecPoint: (tx: Tx, s: Step) => TaskEither<E, void>;
  // TODO use it
  saveArgs: (tx: Tx, args: Args /*TODO type*/) => TaskEither<E, void>;
  saveResp: (tx: Tx, s: R) => TaskEither<E, void>;
  firstStep?: FirstStep;
  finalStep?: FinalStep;
};

type ConfigWithDefaults<
  Tx,
  Step extends RecPointCustomName,
  FirstStep extends string,
  FinalStep extends string,
  E extends Error,
  R,
  Args = any
> = Config<Tx, Step, FirstStep, FinalStep, E, R, Args> & {
  firstStep: FirstStep | 'start';
  finalStep: FinalStep | 'finish';
};

// logic to run after task is done; save rec points & responses to db
const afterTask =
  <
    Tx,
    E extends Error,
    ET extends EffectType,
    R,
    Step extends RecPointCustomName,
    FirstStep extends string,
    FinalStep extends string
  >(
    config: ConfigWithDefaults<Tx, Step, FirstStep, FinalStep, E, R>
  ) =>
  (tx: Tx, name: Step) =>
  <ER extends EffectResult<ET, R, Step>>(e: ER): TaskEither<E, ER> => {
    switch (e.type) {
      case REC_POINT:
        return pipe(
          name,
          config.saveRecPoint.bind(undefined, tx),
          TE.map(() => e)
        );
      case RESP:
        return pipe(
          e.response,
          config.saveResp.bind(undefined, tx),
          TE.map(() => e)
        );
      case NO_OP:
        return TE.right(e);
      default:
        return absurd(e);
    }
  };

// logic that governs how to handle transactions per effect; effects are "local" and "external" where "local" transactions should be started before effect is kicked off,
const inTransaction =
  <Tx, E extends Error, R, Step extends RecPointCustomName, FirstStep extends string, FinalStep extends string>(
    config: ConfigWithDefaults<Tx, Step, FirstStep, FinalStep, E, R>
  ) =>
  (tx: Tx) => {
    let closed = false;
    const close = () => {
      if (!closed) {
        config.closeTransaction(tx);
      }
      closed = true;
      return IO.of(undefined);
    };
    const ffinally = <E, R>(te: TaskEither<E, R>): TaskEither<E, R> =>
      pipe(te, TE.chainFirstIOK(close), TE.orElseFirstIOK(close));
    return {
      tryCatch: <E, R>(f: () => TaskEither<E, R>) => flow(f, ffinally)(),
    };
  };

// isLocal true/false differs in the moment when transaction is requested
const wireIntoLifecycle =
  <
    Tx,
    E extends Error,
    ET extends EffectType,
    R,
    Step extends RecPointCustomName,
    FirstStep extends string,
    FinalStep extends string,
    Args = unknown,
  >(
    config: ConfigWithDefaults<Tx, Step, FirstStep, FinalStep, E, R>
  ) =>
  (ctx: { key: Key; args: Args }) =>
  <TaskError extends Error>(effect: Effect<TaskError, Tx, ET, R, Step>): TaskEither<TaskError | E, EffectResult<ET, R, Step>> => {
    const inTransactionConfigured = inTransaction(config);
    const afterTaskConfigured = afterTask(config);
    return ((ctx_: typeof ctx) =>
      effect.isLocal
        ? flow(config.startTransaction, (tx) => {
            const { tryCatch } = inTransactionConfigured(tx);
            return tryCatch(() => pipe(tx, effect.task(ctx_), TE.chainFirstW(afterTaskConfigured(tx, effect.name))));
          })
        : flow(
            effect.task(ctx_),
            TE.chainW((r) => {
              const tx = config.startTransaction();
              const { tryCatch } = inTransactionConfigured(tx);
              return tryCatch(() => pipe(r, afterTaskConfigured(tx, effect.name)));
            })
          ))(ctx)();
  };

const init =
  <Step extends RecPointCustomName, FirstStep extends string, FinalStep extends string, E extends Error, Tx, R, Args>(
    config: ConfigWithDefaults<Tx, Step, FirstStep, FinalStep, E, R>
  ) =>
  (args: Args): TaskEither<E, IdempotencyKeyDbResult<Step, FirstStep, FinalStep, R, Args>> => {
    const create = flow(
      config.createIdempotencyKey,
      TE.map(
        (key) =>
          ({
            key,
            step: config.firstStep,
            args: undefined,
          } as IdempotencyKeyDbResult<Step, FirstStep, FinalStep, R, Args, FirstStep>)
      )
    );

    const constructFinal = (k: IdempotencyKeyDbResult<Step, FirstStep, FinalStep, R>) =>
      TE.of({
        key: k.key,
        step: config.finalStep,
        args,
        response: k.response! /*TODO compile time check*/,
      });

    const validateAndRefresh = (k: IdempotencyKeyDbResult<Step, FirstStep, FinalStep, R>, tx: Tx) =>
      pipe(
        k.args,
        TE.fromPredicate(
          (savedArgs) => config.argsEqual(savedArgs, args),
          () => new Error('args do not match') as E /*TODO better*/
        ),
        // refresh only existing ones
        TE.chainFirst(() => config.refreshIdempotencyKey(tx, k.key)),
        TE.map(() => k)
      );

    return flow(config.startTransaction, (tx) =>
      inTransaction(config)(tx).tryCatch(() =>
        pipe(
          tx,
          config.getIdempotencyKey,
          TE.chain(
            O.foldW(
              () => create(tx),
              (k) => (k.step === config.finalStep ? constructFinal(k) : validateAndRefresh(k, tx))
            )
          )
        )
      )
    )();
  };

const configWithDefaults = <
  Tx,
  Step extends RecPointCustomName,
  E extends Error,
  R,
  Args = any,
  FirstStep extends string = 'start',
  FinalStep extends string = 'finish'
>(
  config: Config<Tx, Step, FirstStep, FinalStep, E, R>
) => ({
  ...config,
  firstStep: config.firstStep || 'start',
  finalStep: config.finalStep || 'finish',
});

// TODO last has to be a response
// https://www.typescriptlang.org/docs/handbook/release-notes/typescript-4-0.html#variadic-tuple-types
// https://stackoverflow.com/questions/49310886/typing-compose-function-in-typescript-flow-compose
export const run =
  <
    Step extends RecPointCustomName = RecPointCustomName,
    FirstStep extends string = 'start',
    FinalStep extends string = 'finish',
    E extends Error = Error,
    TaskError extends Error = Error,
    Tx = unknown,
    R = unknown,
    ET extends EffectType = EffectType,
    Args = unknown
  >(
    config_: Config<Tx, Step, FirstStep, FinalStep, E, R>
  ) =>
  (effects: RNA.ReadonlyNonEmptyArray<Effect<TaskError, Tx, ET, R, Step>>) =>
  (args: Args): TaskEither<E | TaskError, EffectResult<ET, R, Step>> => {
    const config = configWithDefaults(config_);
    return pipe(
      args,
      init(config),
      TE.chain(({ key, step, args, response }) =>
        step === config.finalStep
          ? TE.right({ type: RESP, response: response! })
          : pipe(
              effects,
              step !== config.firstStep
                ? flow(
                    RA.dropLeftWhile((e) => e.name !== step),
                    RA.dropLeft(1)
                  )
                : identity, // TODO assuming last is *final*
              RNA.fromReadonlyArray,
              TE.fromOption(
                () =>
                  ({
                    e: new Error(
                      'panic! no effect executed although supposed to'
                    ) as TaskError /*should never happen, but TODO custom error type*/,
                    _tag: 'error',
                  } as const)
              ),

              TE.map(RNA.map(wireIntoLifecycle(config)({ key, args }))),
              TE.map(RNA.map(TE.mapLeft((e) => ({ e, _tag: 'error' } as const)))),
              TE.map(
                RNA.map(
                  TE.chainW((e) =>
                    // TODO test RESP would stop execution and move state to finished
                    e.type === RESP
                      ? TE.left({ e, _tag: 'control' } as const) // put into "Left" to contribute to stopping execution
                      : TE.right(e)
                  )
                )
              ),
              TE.chainW(RNA.sequence(TE.ApplicativeSeq)),
              TE.map(RNA.last),
              TE.orElseW(
                (e) => (e._tag === 'control' ? TE.right(e.e) : TE.left(e.e)) // put back into "right" as non-error, restore status quo
              )
            )
      )
    );
  };
