# utils/

## Purpose
Shared utilities used by roles and managers. Currently one module: `bodyBuilder.ts`.

## bodyBuilder.ts
`buildBody(role, budget)` — returns the best affordable `BodyPartConstant[]` for a given role and energy budget.

### Body Scaling Rules
| Role | Repeat unit | Min cost | Max units |
|------|------------|----------|-----------|
| harvester | `[WORK]` + prefix `[CARRY,MOVE]` | 200e | 6 WORK parts |
| hauler | `[CC,M]` | 150e | 10 units |
| upgrader | `[W,W,C,M]` | 350e (fallback 200e) | 10 units |
| builder/repairer | `[W,C,M]` | 200e | 8 units |
| warrior | `[T,A,H,M,M]` (440e) | 130e | 8 units |
| ranger | `[T,RA,H,M,M]` (510e) | 200e | 6 units |
| scout | `[M]` | 50e | 5 parts |
| claimer | `[CLAIM]` + extra MOVE | 650e | +4 MOVE |

### Part Ordering
All bodies are ordered `TOUGH first, MOVE last` so TOUGH absorbs damage before work parts and MOVE survives longest.
