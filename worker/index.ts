import "dotenv/config";
import "./worker"; // creating the Worker starts consuming; the Redis connection keeps the process alive

console.log("👷 [worker] waiting for jobs (Ctrl+C to stop).");
