# No spec delta

Behaviour-preserving decomposition. `createWorktreeHost` and its two action factories
are split into modules; every message the host answers, every projection it publishes
and every action it performs is unchanged, and the 519-case inherited regression net
is pinned byte-identical (design.md OBL-4).
