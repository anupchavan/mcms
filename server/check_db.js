const mongoose = require('mongoose');
const Meeting = require('./src/modules/meeting/meeting.schema');

async function run() {
  await mongoose.connect('mongodb://127.0.0.1:27017/mcms_db');
  const mtgs = await Meeting.find().sort({ createdAt: -1 }).limit(1);
  if(mtgs.length > 0) {
    console.log("Latest Meeting:", mtgs[0].title);
    console.log("Host ID:", mtgs[0].hostId);
    console.log("Participants List:", mtgs[0].participants);
  } else {
    console.log("No meetings found");
  }
  process.exit(0);
}
run();
