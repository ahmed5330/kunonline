// Intentional fail-closed command. The existing Preview DB is Production-bound.
// Never apply arbitrary pending migrations with one npm command.
throw new Error('Preview D1 bulk migration is disabled. Inspect the remote migration ledger READ-ONLY and approve one exact reviewed migration, backups, schema compatibility and restore plan before any manual write. Do not use blanket migrations apply.');
