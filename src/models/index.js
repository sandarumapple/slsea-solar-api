const mongoose = require('mongoose');
const { Schema } = mongoose;
const ref = (name) => ({
  type: Schema.Types.ObjectId,
  ref: name,
  required: true,
  index: true
});

const Province = mongoose.model(
  'Province',
  new Schema(
    {
      name: { type: String, required: true, trim: true },
      code: {
        type: String,
        required: true,
        unique: true,
        uppercase: true,
        trim: true
      }
    },
    { timestamps: true }
  )
);
const District = mongoose.model(
  'District',
  new Schema(
    {
      name: { type: String, required: true, trim: true },
      province: ref('Province')
    },
    { timestamps: true }
  )
);
District.schema.index({ province: 1, name: 1 }, { unique: true });
const GridSubstation = mongoose.model(
  'GridSubstation',
  new Schema(
    {
      name: { type: String, required: true, trim: true },
      code: { type: String, required: true, unique: true, uppercase: true },
      district: ref('District')
    },
    { timestamps: true }
  )
);
const SolarInstallation = mongoose.model(
  'SolarInstallation',
  new Schema(
    {
      installationId: {
        type: String,
        required: true,
        unique: true,
        uppercase: true
      },
      ownerName: { type: String, required: true, trim: true },
      meterId: { type: String, required: true, unique: true },
      inverterId: { type: String, trim: true },
      capacityKw: { type: Number, required: true, min: 0.1 },
      substation: ref('GridSubstation'),
      active: { type: Boolean, default: true }
    },
    { timestamps: true }
  )
);
const GenerationReading = mongoose.model(
  'GenerationReading',
  new Schema(
    {
      installation: ref('SolarInstallation'),
      timestamp: { type: Date, required: true },
      powerKw: { type: Number, required: true, min: 0 },
      cumulativeEnergyKwh: { type: Number, required: true, min: 0 },
      voltage: { type: Number, required: true, min: 100, max: 500 }
    },
    { timestamps: { createdAt: true, updatedAt: false } }
  )
);
GenerationReading.schema.index(
  { installation: 1, timestamp: -1 },
  { unique: true }
);
const userSchema = new Schema(
    {
      name: { type: String, required: true },
      email: {
        type: String,
        required: true,
        unique: true,
        lowercase: true,
        trim: true
      },
      passwordHash: { type: String, required: true },
      role: {
        type: String,
        enum: [
          'ADMIN',
          'SYSTEM_ADMIN',
          'PROVINCE_OFFICER',
          'DISTRICT_OFFICER',
          'SUBSTATION_OFFICER',
          'DEVICE'
        ],
        required: true
      },
      jurisdictionType: {
        type: String,
        enum: [
          'NATIONAL',
          'PROVINCE',
          'DISTRICT',
          'SUBSTATION',
          'INSTALLATION'
        ],
        required: true
      },
      jurisdictionRef: {
        type: Schema.Types.ObjectId,
        refPath: 'jurisdictionModel'
      },
      jurisdictionModel: {
        type: String,
        enum: ['Province', 'District', 'GridSubstation', 'SolarInstallation']
      },
      active: { type: Boolean, default: true }
    },
    { timestamps: true }
  );
userSchema.pre('validate', function () {
  const expected = {
    ADMIN: ['NATIONAL', undefined],
    SYSTEM_ADMIN: ['NATIONAL', undefined],
    PROVINCE_OFFICER: ['PROVINCE', 'Province'],
    DISTRICT_OFFICER: ['DISTRICT', 'District'],
    SUBSTATION_OFFICER: ['SUBSTATION', 'GridSubstation'],
    DEVICE: ['INSTALLATION', 'SolarInstallation']
  }[this.role];
  if (!expected) return;
  if (this.jurisdictionType !== expected[0])
    this.invalidate('jurisdictionType', 'Jurisdiction must match role');
  if (expected[1]) {
    if (!this.jurisdictionRef) this.invalidate('jurisdictionRef', 'Scoped accounts require a jurisdiction');
    if (this.jurisdictionModel !== expected[1]) this.invalidate('jurisdictionModel', 'Model must match role');
  } else if (this.jurisdictionRef || this.jurisdictionModel) {
    this.invalidate('jurisdictionRef', 'National accounts must not carry a narrower jurisdiction');
  }
});
const User = mongoose.model('User', userSchema);
module.exports = {
  Province,
  District,
  GridSubstation,
  SolarInstallation,
  GenerationReading,
  User
};
