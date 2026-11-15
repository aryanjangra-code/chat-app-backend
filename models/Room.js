import mongoose from "mongoose";

const roomSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: function () {
        return this.type === "group";
      },
      trim: true,
      maxlength: 40,
    },
    type: {
      type: String,
      enum: ["group", "dm"],
      required: true,
      default: "group",
    },
    members: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    lastMessageAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

// For DMs, prevent duplicate rooms between the same two users
roomSchema.index({ type: 1, members: 1 });

export default mongoose.model("Room", roomSchema);
