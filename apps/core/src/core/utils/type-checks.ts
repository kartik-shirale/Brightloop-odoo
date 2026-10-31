/**
 * Compile-time helper for the Zod-to-shared check (backend plan 3.5). A schema
 * file ends with, for example:
 *
 *   export type CreateXCheck = AssertAssignable<CreateXInput, CreateXRequest>;
 *
 * Typecheck fails when the schema's inferred type stops matching the shared type.
 */
export type AssertAssignable<T extends U, U> = T;
