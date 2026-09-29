import { z } from "zod";

const optionalUuid = z
  .string()
  .uuid()
  .optional()
  .or(z.literal("").transform(() => undefined));

/** Shared by the add and edit property forms. */
export const propertySchema = z.object({
  communityId: optionalUuid,
  newCommunity: z.string().max(80).optional(),
  emirate: z.enum([
    "dubai", "abu_dhabi", "sharjah", "ajman",
    "umm_al_quwain", "ras_al_khaimah", "fujairah",
  ]),
  name: z.string().min(2, "Property name is required").max(120),
  kind: z.enum([
    "building", "villa_compound", "standalone_villa",
    "townhouse_cluster", "mixed_use",
  ]),
  developerName: z.string().max(120).optional(),
  addressLine: z.string().max(200).optional(),
  makaniNumber: z.string().max(20).optional(),
  floors: z.coerce.number().int().min(0).max(200).optional(),
  totalUnits: z.coerce.number().int().min(0).optional(),
  ownersAssociationName: z.string().max(120).optional(),
  mollakPropertyId: z.string().max(40).optional(),
});
