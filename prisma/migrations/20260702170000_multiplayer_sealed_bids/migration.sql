DELETE FROM "multiplayer_bids" AS bid
USING (
    SELECT
        "id",
        ROW_NUMBER() OVER (
            PARTITION BY "round_id", "participant_id"
            ORDER BY "created_at" ASC, "id" ASC
        ) AS row_number
    FROM "multiplayer_bids"
) AS ranked_bid
WHERE bid."id" = ranked_bid."id"
  AND ranked_bid.row_number > 1;

CREATE UNIQUE INDEX "multiplayer_bids_round_id_participant_id_key"
ON "multiplayer_bids"("round_id", "participant_id");
