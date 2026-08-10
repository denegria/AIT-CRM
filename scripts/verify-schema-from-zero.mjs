import { schemaFromZeroOptionsFromEnv, verifySchemaFromZero } from './lib/schema-from-zero.mjs';

try {
  const result = await verifySchemaFromZero({ options: schemaFromZeroOptionsFromEnv() });
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(error.message || error);
  process.exit(1);
}
