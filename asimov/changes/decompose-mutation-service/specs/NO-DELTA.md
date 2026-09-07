# No spec delta

Behaviour-preserving decomposition. `createWorktreeMutationService` is split into
modules; every mutation it performs, every outcome it returns and every authorization it
issues is unchanged, and the 218-case inherited regression net is pinned byte-identical
(design.md OBL-3).
