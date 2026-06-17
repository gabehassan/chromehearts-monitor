import handler from "../api/cron.js";

const req = {
  method: "GET",
  headers: {
    authorization: process.env.CRON_SECRET ? `Bearer ${process.env.CRON_SECRET}` : ""
  }
};

const res = {
  statusCode: 200,
  status(code) {
    this.statusCode = code;
    return this;
  },
  setHeader() {},
  json(body) {
    console.log(JSON.stringify({ statusCode: this.statusCode, body }, null, 2));
  }
};

await handler(req, res);
