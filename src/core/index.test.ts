import { describe, expect, test, jest } from '@jest/globals';
import * as TE from 'fp-ts/TaskEither';
import { Config, NO_OP, NoOp, REC_POINT, RecPoint, RecPointCustomName, run } from './index';
import { none } from 'fp-ts/Option';
import { left, right } from 'fp-ts/Either';
import { pipe } from 'fp-ts/function';

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
    const task1r = jest.fn(TE.of({
      type: REC_POINT,
    }));
    const task1 = {
      isLocal: true as const,
      name: 'task1' as RecPointCustomName,
      task: jest.fn((ctx: { args: Args; key: string }) => (tx: Tx) => task1r),
    };
    expect(await run(config)([task1])({} as Args)()).toStrictEqual(right({
      type: REC_POINT
    }));
    expect(task1r).toHaveBeenCalledTimes(1);
  });

  // TODO handles first fail

  test('should run multiple tasks', async () => {
    const task1r = jest.fn(TE.of({
      type: REC_POINT,
    }));
    const task1 = {
      isLocal: true as const,
      name: 'task1' as RecPointCustomName,
      task: jest.fn((ctx: { args: Args; key: string }) => (tx: Tx) => task1r),
    };
    const task2r = jest.fn(TE.of({
      type: REC_POINT,
    }));
    const task2 = {
      isLocal: false as const,
      name: 'task2' as RecPointCustomName,
      task: jest.fn((ctx: { args: Args; key: string }) => () => task2r),
    };
    const task3r = jest.fn(TE.of({
      type: NO_OP,
    }));
    const task3 = {
      isLocal: true as const,
      name: 'task3' as RecPointCustomName,
      task: jest.fn((ctx: { args: Args; key: string }) => (tx: Tx) => task3r),
    };
    expect(await run(config)([task1, task2, task3])({} as Args)()).toStrictEqual(right({
      type: NO_OP
    }));
    expect(task1r).toHaveBeenCalledTimes(1);
    expect(task2r).toHaveBeenCalledTimes(1);
    expect(task3r).toHaveBeenCalledTimes(1);
  });
  test('should stop on fail', async () => {
    const task1r = jest.fn(TE.of({
      type: REC_POINT,
    }));
    const task1 = {
      isLocal: true as const,
      name: 'task1' as RecPointCustomName,
      task: jest.fn((ctx: { args: Args; key: string }) => (tx: Tx) => task1r),
    };
    const task2Er = jest.fn(pipe(TE.of({
      type: REC_POINT,
    }), TE.chainFirstW(() => TE.left(new Error('error')))));
    const task2E = {
      isLocal: false as const,
      name: 'task2' as RecPointCustomName,
      task: jest.fn((ctx: { args: Args; key: string }) => () => task2Er),
    };
    const task3r = jest.fn(TE.of({
      type: REC_POINT,
    }));
    const task3 = {
      isLocal: true as const,
      name: 'task3' as RecPointCustomName,
      task: jest.fn((ctx: { args: Args; key: string }) => (tx: Tx) => task3r),
    };
    expect(await run(config)([task1, task2E, task3])({} as Args)()).toStrictEqual(left(new Error('error')));
    expect(task1r).toHaveBeenCalledTimes(1);
    expect(task2Er).toHaveBeenCalledTimes(1);
    expect(task3r).toHaveBeenCalledTimes(0);
  });

  // TODO can continue

})