-- Add the foreign keys declared in schema.prisma for the patient-side billing tables.
-- Rows are kept. Referenced ids must already exist; nothing is deleted or rewritten.

ALTER TABLE "PatientLedgerEntry" ADD CONSTRAINT "PatientLedgerEntry_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PatientLedgerEntry" ADD CONSTRAINT "PatientLedgerEntry_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ClientCopayRule" ADD CONSTRAINT "ClientCopayRule_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ClientCopayRule" ADD CONSTRAINT "ClientCopayRule_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ValantInsuranceAgingSnapshot" ADD CONSTRAINT "ValantInsuranceAgingSnapshot_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ValantAgingSnapshot" ADD CONSTRAINT "ValantAgingSnapshot_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ValantAgingSnapshot" ADD CONSTRAINT "ValantAgingSnapshot_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ValantCombinedAgingRow" ADD CONSTRAINT "ValantCombinedAgingRow_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ValantCombinedAgingRow" ADD CONSTRAINT "ValantCombinedAgingRow_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ValantAgingSettings" ADD CONSTRAINT "ValantAgingSettings_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ValantTransaction" ADD CONSTRAINT "ValantTransaction_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ValantTransaction" ADD CONSTRAINT "ValantTransaction_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ValantProviderMap" ADD CONSTRAINT "ValantProviderMap_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ValantPayer" ADD CONSTRAINT "ValantPayer_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ValantPayer" ADD CONSTRAINT "ValantPayer_payerRegistryId_fkey" FOREIGN KEY ("payerRegistryId") REFERENCES "PayerRegistry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ValantPayerAddress" ADD CONSTRAINT "ValantPayerAddress_payerId_fkey" FOREIGN KEY ("payerId") REFERENCES "ValantPayer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "IntensiveChargeDraft" ADD CONSTRAINT "IntensiveChargeDraft_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "IntensiveChargeDraft" ADD CONSTRAINT "IntensiveChargeDraft_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Postgres truncated these 63-character names. Rename them to Prisma's names. No rows change.
ALTER INDEX "ClientCopayRule_clientId_source_payerName_providerType_cptRule_" RENAME TO "ClientCopayRule_clientId_source_payerName_providerType_cptR_key";
ALTER INDEX "IntensiveChargeDraft_enrollmentId_serviceDate_code_sourceKey_ke" RENAME TO "IntensiveChargeDraft_enrollmentId_serviceDate_code_sourceKe_key";
