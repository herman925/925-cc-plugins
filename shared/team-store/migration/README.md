# Classic migration foundations

These are native-only foundations for [migration #15](https://github.com/herman925/925-cc-plugins/issues/15). They are not connected to a model tool or the installed clients. No live migration has been performed.

`captureClassicSource` reads a bounded, nonredirected classic project directory twice and retains every captured byte. `previewClassicImport` checks its fingerprint, maps the reporting tree and separates review information from the private complete archive. Session references are historical hints; no binding, grant, task, delivery or pickup deadline is created. Unfinished notes/messages require head review and a fresh assignment, as Herman selected on 2026-11-08. Old generated CLI/permission instructions are archived, not promoted to new official instructions. Both proposed permission switches start off; prior values remain visible as history and are not transferred. Enabling them later uses normal team editing, per Herman's subsequent native multiple-choice answer. Explicitly pruned messages stay archived; an uncertain sending record requires outcome reconciliation before fresh work.

`backupClassicSource` saves an immutable, readback-verified private archive outside the project. It preserves binary files and even a malformed roster for recovery; a malformed roster still cannot be imported. A changed/partial backup refuses further work rather than being overwritten. `classicImportCommand` builds a complete bounded native-review proposal, preserves the reporting tree, puts unfinished records in the head's advisory review section and fixes both permissions off. Its reviewed target home must match the real importing actor; remote/different original homes require explicit mapping instead of silent relocation.

The private `createTeamApi().importClassicTeam` operation requires a specific native review and a trusted post-review source/backup/native-state verifier. Target hierarchy, role/advisory documents and a source/backup receipt commit atomically through the existing store transaction. No sessions, tasks or deadlines are created. Reconcile an uncertain outcome with the exact `reconcileClassicImport` request; it never repeats the effect and does not require another approval. Both operations are absent from every public MCP command catalogue.

Native client UI, real post-review source-session verification, mapping of multiple heads/remote homes, and the selected activation/handover workflow remain incomplete. The verifier in tests substitutes native source state; it is not an attestation. A future client must recapture the source fingerprint after review, verify its complete backup, obtain safe source-session evidence and retain the exact operation through uncertain replies. Existing source files remain intact. Multiple heads, unmapped bosses, cycles, role-path collisions and unsupported providers require resolution; this preview never silently repairs or drops them. Case-colliding paths are rejected for portability. The current import contract supports at most 30 members, and larger sources are kept intact with an explicit blocker.

Run the fixture tests with Node 22.13 or newer:

```sh
node --test shared/team-store/migration/*.test.mjs
```
