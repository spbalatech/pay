-- CreateEnum
CREATE TYPE "DataSource" AS ENUM ('LIVE_SANDBOX', 'SIMULATED');

-- CreateEnum
CREATE TYPE "RiskTier" AS ENUM ('CLEAR', 'REVIEW', 'HOLD');

-- CreateEnum
CREATE TYPE "WatchStatus" AS ENUM ('OPEN', 'DEFLECTED', 'ESCALATED_TO_DISPUTE', 'DISMISSED');

-- CreateEnum
CREATE TYPE "InterventionKind" AS ENUM ('OUTREACH', 'TRACKING_RESEND', 'PREEMPTIVE_REFUND', 'SUBSCRIPTION_PAUSE', 'FULFILLMENT_HOLD');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('PROPOSED', 'AUTO_APPROVED', 'HUMAN_APPROVED', 'HUMAN_REJECTED', 'EXECUTED', 'FAILED');

-- CreateEnum
CREATE TYPE "DisputeDecision" AS ENUM ('UNDECIDED', 'FIGHT', 'ACCEPT');

-- CreateEnum
CREATE TYPE "DisputeOutcome" AS ENUM ('PENDING', 'WON', 'LOST', 'ACCEPTED');

-- CreateEnum
CREATE TYPE "RuleStatus" AS ENUM ('PROPOSED', 'ACTIVE', 'REJECTED', 'SUPERSEDED');

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "paypalOrderId" TEXT NOT NULL,
    "captureId" TEXT,
    "payerId" TEXT NOT NULL,
    "payerEmail" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "status" TEXT NOT NULL,
    "billingCountry" TEXT,
    "shippingCountry" TEXT,
    "shippingLine1" TEXT,
    "shippingIsMultiUnit" BOOLEAN NOT NULL DEFAULT false,
    "items" JSONB NOT NULL,
    "rushShipping" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "capturedAt" TIMESTAMP(3),
    "promiseDate" TIMESTAMP(3),
    "fulfilledAt" TIMESTAMP(3),
    "source" "DataSource" NOT NULL DEFAULT 'LIVE_SANDBOX',

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transaction" (
    "id" TEXT NOT NULL,
    "paypalTransactionId" TEXT NOT NULL,
    "payerId" TEXT NOT NULL,
    "payerEmail" TEXT,
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "source" "DataSource" NOT NULL DEFAULT 'LIVE_SANDBOX',

    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Shipment" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "trackingNumber" TEXT NOT NULL,
    "carrier" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "signatureRequired" BOOLEAN NOT NULL DEFAULT false,
    "shippedAt" TIMESTAMP(3),
    "lastMovementAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "source" "DataSource" NOT NULL DEFAULT 'LIVE_SANDBOX',

    CONSTRAINT "Shipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "paypalSubscriptionId" TEXT NOT NULL,
    "payerId" TEXT NOT NULL,
    "payerEmail" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "planName" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "status" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "lastRenewedAt" TIMESTAMP(3),
    "lastBuyerActivityAt" TIMESTAMP(3),
    "source" "DataSource" NOT NULL DEFAULT 'LIVE_SANDBOX',

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "paypalInvoiceId" TEXT NOT NULL,
    "payerEmail" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "status" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL,
    "dueAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "source" "DataSource" NOT NULL DEFAULT 'LIVE_SANDBOX',

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiskAssessment" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "tier" "RiskTier" NOT NULL,
    "signals" JSONB NOT NULL,
    "predictedReasonCodes" JSONB NOT NULL,
    "narrative" TEXT NOT NULL,
    "recommendation" TEXT NOT NULL,
    "matchedRuleIds" JSONB NOT NULL DEFAULT '[]',
    "decision" "ApprovalStatus" NOT NULL DEFAULT 'PROPOSED',
    "decidedBy" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RiskAssessment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Watch" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "precursor" TEXT NOT NULL,
    "severity" INTEGER NOT NULL,
    "predictedReasonCode" TEXT NOT NULL,
    "amountAtRisk" DECIMAL(12,2) NOT NULL,
    "rationale" TEXT NOT NULL,
    "status" "WatchStatus" NOT NULL DEFAULT 'OPEN',
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "Watch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Intervention" (
    "id" TEXT NOT NULL,
    "watchId" TEXT NOT NULL,
    "kind" "InterventionKind" NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PROPOSED',
    "approvedBy" TEXT,
    "executedAt" TIMESTAMP(3),
    "result" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Intervention_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Dispute" (
    "id" TEXT NOT NULL,
    "paypalDisputeId" TEXT NOT NULL,
    "orderId" TEXT,
    "reasonCode" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "buyerNote" TEXT,
    "filedAt" TIMESTAMP(3) NOT NULL,
    "responseDueAt" TIMESTAMP(3),
    "source" "DataSource" NOT NULL DEFAULT 'SIMULATED',

    CONSTRAINT "Dispute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DisputeAssessment" (
    "id" TEXT NOT NULL,
    "disputeId" TEXT NOT NULL,
    "pWin" DOUBLE PRECISION NOT NULL,
    "evFight" DECIMAL(12,2) NOT NULL,
    "evAccept" DECIMAL(12,2) NOT NULL,
    "evidenceStrength" INTEGER NOT NULL,
    "evidence" JSONB NOT NULL,
    "timeline" JSONB NOT NULL,
    "recommendation" "DisputeDecision" NOT NULL,
    "rebuttalDraft" TEXT,
    "decision" "DisputeDecision" NOT NULL DEFAULT 'UNDECIDED',
    "decisionStatus" "ApprovalStatus" NOT NULL DEFAULT 'PROPOSED',
    "decidedBy" TEXT,
    "executedAt" TIMESTAMP(3),
    "outcome" "DisputeOutcome" NOT NULL DEFAULT 'PENDING',
    "outcomeAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DisputeAssessment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Rule" (
    "id" TEXT NOT NULL,
    "plainEnglish" TEXT NOT NULL,
    "condition" JSONB NOT NULL,
    "action" TEXT NOT NULL,
    "status" "RuleStatus" NOT NULL DEFAULT 'PROPOSED',
    "derivedFrom" JSONB NOT NULL,
    "projectedDisputesAvoided" INTEGER NOT NULL,
    "projectedSavings" DECIMAL(12,2) NOT NULL,
    "observedMatches" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedAt" TIMESTAMP(3),
    "approvedBy" TEXT,

    CONSTRAINT "Rule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Order_paypalOrderId_key" ON "Order"("paypalOrderId");

-- CreateIndex
CREATE INDEX "Order_payerId_idx" ON "Order"("payerId");

-- CreateIndex
CREATE INDEX "Order_createdAt_idx" ON "Order"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_paypalTransactionId_key" ON "Transaction"("paypalTransactionId");

-- CreateIndex
CREATE INDEX "Transaction_payerId_occurredAt_idx" ON "Transaction"("payerId", "occurredAt");

-- CreateIndex
CREATE INDEX "Shipment_orderId_idx" ON "Shipment"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_paypalSubscriptionId_key" ON "Subscription"("paypalSubscriptionId");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_paypalInvoiceId_key" ON "Invoice"("paypalInvoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "RiskAssessment_orderId_key" ON "RiskAssessment"("orderId");

-- CreateIndex
CREATE INDEX "Watch_status_idx" ON "Watch"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Watch_orderId_precursor_key" ON "Watch"("orderId", "precursor");

-- CreateIndex
CREATE UNIQUE INDEX "Dispute_paypalDisputeId_key" ON "Dispute"("paypalDisputeId");

-- CreateIndex
CREATE INDEX "Dispute_status_idx" ON "Dispute"("status");

-- CreateIndex
CREATE INDEX "Dispute_responseDueAt_idx" ON "Dispute"("responseDueAt");

-- CreateIndex
CREATE UNIQUE INDEX "DisputeAssessment_disputeId_key" ON "DisputeAssessment"("disputeId");

-- CreateIndex
CREATE INDEX "AuditLog_at_idx" ON "AuditLog"("at");

-- CreateIndex
CREATE INDEX "AuditLog_targetType_targetId_idx" ON "AuditLog"("targetType", "targetId");

-- AddForeignKey
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskAssessment" ADD CONSTRAINT "RiskAssessment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Watch" ADD CONSTRAINT "Watch_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Intervention" ADD CONSTRAINT "Intervention_watchId_fkey" FOREIGN KEY ("watchId") REFERENCES "Watch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dispute" ADD CONSTRAINT "Dispute_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DisputeAssessment" ADD CONSTRAINT "DisputeAssessment_disputeId_fkey" FOREIGN KEY ("disputeId") REFERENCES "Dispute"("id") ON DELETE CASCADE ON UPDATE CASCADE;
