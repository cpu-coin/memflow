import { SQLiteConnector, type SQLiteConnectorConfig } from "./sqlite.js";

export interface EmbeddedConnectorConfig extends Omit<SQLiteConnectorConfig, "databasePath" | "readOnly" | "walMode"> {
  databasePath?: string;
}

export class EmbeddedConnector extends SQLiteConnector {
  override readonly kind = "embedded" as const;
  override readonly name = "embedded";

  constructor(config: EmbeddedConnectorConfig = {}) {
    super({
      ...config,
      databasePath: config.databasePath ?? ":memory:",
      readOnly: false,
      walMode: false,
    });
  }
}
