const mongoose = require('mongoose');

const caseHistorySchema = new mongoose.Schema(
  {
    caseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Case',
      required: true,
      index: true,
    },
    actionType: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    description: {
      type: String,
      required: true,
      trim: true,
    },
    performedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      index: true,
    },
    performedByOfficer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Officer',
    },
    performedByRole: {
      type: String,
      trim: true,
    },
    performedByRank: {
      type: String,
      trim: true,
    },
    previousValue: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    newValue: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    timestamp: {
      type: Date,
      default: Date.now,
      index: true,
    },
  },
  {
    timestamps: true,
  },
);

caseHistorySchema.index({ caseId: 1, timestamp: 1 });

module.exports = mongoose.model('CaseHistory', caseHistorySchema);
