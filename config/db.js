import mongoose from "mongoose";

const dropStaleEmailIndex = async (conn) => {
  try {
    const usersCollection = conn.connection.collection("users");
    const indexes = await usersCollection.indexes();
    const staleEmailIndex = indexes.find((index) => index.name === "email_1");

    if (staleEmailIndex) {
      await usersCollection.dropIndex("email_1");
      console.log("Dropped stale unique email index from users collection");
    }
  } catch (error) {
    console.warn("Unable to clean stale user indexes:", error.message);
  }
};

export const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGO_URI);
    await dropStaleEmailIndex(conn);
    console.log(`MongoDB connected: ${conn.connection.host}`);
    return conn;
  } catch (err) {
    console.warn("MongoDB connection error, continuing without DB for local auth fallback:", err.message);
    return null;
  }
};
