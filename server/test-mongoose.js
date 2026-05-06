const mongoose = require("mongoose");

async function test() {
    await mongoose.connect("mongodb://127.0.0.1:27017/mcms_test", {
        serverSelectionTimeoutMS: 2000,
    });
    const schema1 = new mongoose.Schema({
        meetingId: mongoose.Schema.Types.ObjectId,
        name: String,
    });
    const Model1 = mongoose.model("TestModel", schema1);

    await Model1.deleteMany({});
    const id = new mongoose.Types.ObjectId();
    await Model1.create({ meetingId: id, name: "test" });

    const schema2 = new mongoose.Schema({ meetingId: String, name: String });
    // delete from mongoose models to redefine
    delete mongoose.models["TestModel"];
    const Model2 = mongoose.model("TestModel", schema2);

    const res = await Model2.find({ meetingId: id.toString() });
    console.log("Found with String schema:", res.length);
    process.exit(0);
}
test().catch(console.error);
