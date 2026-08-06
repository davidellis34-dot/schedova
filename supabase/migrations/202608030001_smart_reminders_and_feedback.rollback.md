# Rollback notes

Use a reviewed Supabase migration rather than a database reset. To remove this
foundation, first disable `EXPO_PUBLIC_ENABLE_SMART_REMINDERS`, deploy the app,
and ensure no active workflow reads the new columns or tables. Then, after
exporting any feedback and reminder-audit rows that must be retained, drop the
two new tables and the three `services` rebooking constraints and columns.

Do not remove historical appointment, service, client, or message records as
part of this rollback.
