import { z } from "zod";
import { router, permissionProcedure } from "../_core/trpc";
import { listCommerceTransactionsByVenue, listCommerceTransactionItems } from "../segolife/commerce/commerceDb";

const commerceViewProcedure = permissionProcedure("commerce.view", ["admin"]);

export const commerceRouter = router({
  listByVenue: commerceViewProcedure
    .input(z.object({ venueId: z.number().int().positive() }))
    .query(({ input }) => listCommerceTransactionsByVenue(input.venueId)),

  listItems: commerceViewProcedure
    .input(z.object({ transactionId: z.number().int().positive() }))
    .query(({ input }) => listCommerceTransactionItems(input.transactionId)),
});
