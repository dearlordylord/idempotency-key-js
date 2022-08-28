import { describe, expect, test, jest } from '@jest/globals';
import * as TE from 'fp-ts/TaskEither';
import { Config, NO_OP, REC_POINT, RecPointCustomName, run } from './index';
import { none } from 'fp-ts/Option';
import { right } from 'fp-ts/Either';

type Tx = any;
type Args = any;
type Resp = any;

const config = Object.freeze({
  getIdempotencyKey: (tx: Tx) => TE.of(none),
  argsEqual: (a1: Args, a2: Args) => true,
  refreshIdempotencyKey: (tx: Tx) => TE.of(undefined),
  createIdempotencyKey: (tx: Tx) => TE.of('ikey'),
  startTransaction: () => TE.of(undefined as Tx),
  closeTransaction: (tx: Tx) => undefined,
  saveRecPoint: (tx: Tx, recPoint: string) => TE.of(undefined),
  saveArgs: (tx: Tx, args: Args) => TE.of(undefined),
  saveResp: (tx: Tx, resp: Resp) => TE.of(undefined),
});

describe('lib', () => {
  test('should run a sole task', async () => {
    const task1 = {
      isLocal: true as const,
      name: 'task1' as RecPointCustomName,
      task: jest.fn((ctx: { args: Args; key: string }) => (tx: Tx) => TE.of({
        type: REC_POINT,
      })),
    };
    expect(await run(config)([task1])({} as Args)()).toStrictEqual(right({
      type: REC_POINT
    }));
    expect(task1.task).toHaveBeenCalledTimes(1);
  });
  test('should run multiple tasks', async () => {
    const task1 = {
      isLocal: true as const,
      name: 'task1' as RecPointCustomName,
      task: jest.fn((ctx: { args: Args; key: string }) => (tx: Tx) => TE.of({
        type: REC_POINT,
      })),
    };
    const task2 = {
      isLocal: false as const,
      name: 'task2' as RecPointCustomName,
      task: jest.fn((ctx: { args: Args; key: string }) => () => TE.of({
        type: REC_POINT,
      })),
    };
    const task3 = {
      isLocal: true as const,
      name: 'task3' as RecPointCustomName,
      task: jest.fn((ctx: { args: Args; key: string }) => (tx: Tx) => TE.of({
        type: NO_OP,
      })),
    };
    expect(await run(config)([task1, task2, task3])({} as Args)()).toStrictEqual(right({
      type: NO_OP
    }));
    expect(task1.task).toHaveBeenCalledTimes(1);
    expect(task2.task).toHaveBeenCalledTimes(1);
    expect(task3.task).toHaveBeenCalledTimes(1);
  });
})