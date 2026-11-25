# @formless63/registrar

The contract a registrar adapter implements. Types only, plus a conformance kit.

```ts
import type { Registrar, RegistrarDomain } from "@formless63/registrar";
import { assertRegistrarConformance } from "@formless63/registrar/testing";

// In any test runner, against an adapter with a stubbed transport:
await assertRegistrarConformance(myAdapter, { knownDomain: "example.com" });
```

`null` fields mean "not stated"; `capabilities` says what an API can report at all. Money is a decimal string
with a currency, never a float. The contract is read-only.
