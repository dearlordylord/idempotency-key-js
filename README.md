a draft of idempotency key api util implementation based on https://brandur.org/idempotency-keys

is to be very generic, backend/database independent; only the base logic of the "algorithm" is here

implemented with fp-ts

TODO

- beforeTasks
- upsertIdempotencyKey
- probably, pass idempotency key around, make it visible to Effects
- tests
- real use case 