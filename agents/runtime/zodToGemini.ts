/**
 * Convert Zod schemas into Gemini function-declaration schemas.
 * Covers the subset used by SchediCare tools: objects, strings, enums,
 * numbers, booleans, arrays, literals, optional/nullable/default wrappers.
 */
import { z } from "zod";
import { Type, type Schema } from "@google/genai";

export function zodToGemini(schema: z.ZodTypeAny): Schema {
  const def = (schema as any)._def;
  const typeName: string = def?.typeName;

  switch (typeName) {
    case z.ZodFirstPartyTypeKind.ZodOptional:
    case z.ZodFirstPartyTypeKind.ZodNullable:
      return { ...zodToGemini(def.innerType), nullable: true };
    case z.ZodFirstPartyTypeKind.ZodDefault:
      return zodToGemini(def.innerType);
    case z.ZodFirstPartyTypeKind.ZodEffects:
      return zodToGemini(def.schema);
    case z.ZodFirstPartyTypeKind.ZodObject: {
      const shape = def.shape() as Record<string, z.ZodTypeAny>;
      const properties: Record<string, Schema> = {};
      const required: string[] = [];
      for (const [key, value] of Object.entries(shape)) {
        properties[key] = zodToGemini(value);
        const vDef = (value as any)._def;
        const optional =
          vDef?.typeName === z.ZodFirstPartyTypeKind.ZodOptional ||
          vDef?.typeName === z.ZodFirstPartyTypeKind.ZodDefault ||
          (value as any).isOptional?.();
        if (!optional) required.push(key);
      }
      const out: Schema = { type: Type.OBJECT, properties };
      if (required.length) out.required = required;
      if (schema.description) out.description = schema.description;
      return out;
    }
    case z.ZodFirstPartyTypeKind.ZodString: {
      const out: Schema = { type: Type.STRING };
      if (schema.description) out.description = schema.description;
      return out;
    }
    case z.ZodFirstPartyTypeKind.ZodNumber: {
      const isInt = (def.checks ?? []).some((c: any) => c.kind === "int");
      const out: Schema = { type: isInt ? Type.INTEGER : Type.NUMBER };
      if (schema.description) out.description = schema.description;
      return out;
    }
    case z.ZodFirstPartyTypeKind.ZodBoolean:
      return { type: Type.BOOLEAN, ...(schema.description ? { description: schema.description } : {}) };
    case z.ZodFirstPartyTypeKind.ZodEnum:
      return {
        type: Type.STRING,
        enum: def.values as string[],
        ...(schema.description ? { description: schema.description } : {}),
      };
    case z.ZodFirstPartyTypeKind.ZodLiteral:
      return { type: Type.STRING, enum: [String(def.value)] };
    case z.ZodFirstPartyTypeKind.ZodArray: {
      const out: Schema = { type: Type.ARRAY, items: zodToGemini(def.type) };
      if (schema.description) out.description = schema.description;
      return out;
    }
    case z.ZodFirstPartyTypeKind.ZodRecord:
      return { type: Type.OBJECT, description: schema.description ?? "key-value map" };
    case z.ZodFirstPartyTypeKind.ZodUnion: {
      const options: z.ZodTypeAny[] = def.options;
      if (options.every((o) => (o as any)._def.typeName === z.ZodFirstPartyTypeKind.ZodLiteral)) {
        return { type: Type.STRING, enum: options.map((o) => String((o as any)._def.value)) };
      }
      return zodToGemini(options[0]);
    }
    default:
      return { type: Type.STRING, description: `unsupported zod type ${typeName}` };
  }
}
