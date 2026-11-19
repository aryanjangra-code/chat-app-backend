import mongoose from "mongoose";
import bcrypt from "bcryptjs";

const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true, trim: true, minlength: 3, maxlength: 20 },
  password: { type: String, required: true, minlength: 6 },
  avatarColor: {
    type: String,
    default: () => {
      const colors = ["#F97362", "#5B8DEF", "#3DBE8B", "#F5B841", "#B98BF0", "#4FBBC4"];
      return colors[Math.floor(Math.random() * colors.length)];
    },
  },
  status: { type: String, default: "Hey there! I'm using GroupChat", maxlength: 60 },
  isOnline: { type: Boolean, default: false },
  lastSeen: { type: Date, default: Date.now },
}, { timestamps: true });

userSchema.pre("save", async function () {
  if (!this.isModified("password")) return;
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
});

userSchema.methods.comparePassword = function (candidate) {
  return bcrypt.compare(candidate, this.password);
};

userSchema.methods.toSafeObject = function () {
  return {
    id: this._id,
    username: this.username,
    avatarColor: this.avatarColor,
    status: this.status,
    isOnline: this.isOnline,
    lastSeen: this.lastSeen,
  };
};

export default mongoose.model("User", userSchema);
