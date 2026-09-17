import {
  forwardValidationOptionsFromEnv,
  verifyForwardSchemaOnDisposable,
} from './lib/forward-schema-validation.mjs';

try {
  const result = await verifyForwardSchemaOnDisposable({ options: forwardValidationOptionsFromEnv() });
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(error.message || error);
  process.exitCode = 1;
}
