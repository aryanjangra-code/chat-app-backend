import mongoose from "mongoose";

export const connectDB = async () => {
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI must be configured");
  mongoose.set("strictQuery", true);

  const conn = await mongoose.connect(process.env.MONGO_URI, {
    serverSelectionTimeoutMS: 10000,
  });

  console.log(`MongoDB connected: ${conn.connection.host}`);
  return conn;
};
