import { closeDb, initDb } from "./index";

await initDb();
await closeDb();
