# No spec delta

Behaviour-preserving decomposition. `WorktreeController` and `WorktreeView` are split
into collaborators; every message the controller handles, every row the view draws and
every dialog either opens is unchanged, and the 510-case inherited regression net is
pinned byte-identical (design.md OBL-4).
