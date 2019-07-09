import { default as clone } from "clone";

export const extendRxDB = $this => {
    // only update specified fields, other fields use old data if existed
    const upsertWithFields = async (json, fields: string[] = []) => {
        json = clone(json);
        const primary = json[$this.schema.primaryPath];
        if (!primary) {
            throw new Error("RxCollection.upsertWithFields() does not work without primary");
        }

        const existing = await $this.findOne(primary).exec();
        if (existing) {
            for (let prop in json) {
                if (json.hasOwnProperty(prop) && fields.indexOf(prop) < 0) {
                    delete json[prop];
                }
            }

            const data = existing._data;
            json = Object.assign({}, data, json);
            json._rev = existing._rev;
            existing._data = json;
            await existing.save();
            return existing;
        } else {
            const newDoc = await $this.insert(json);
            return newDoc;
        }
    };

    // ignore some fields when update
    const upsertExcludeFields = async (json, fields = []) => {
        json = clone(json);
        const primary = json[$this.schema.primaryPath];
        if (!primary) {
            throw new Error("RxCollection.upsertExcludeFields() does not work without primary");
        }

        const existing = await $this.findOne(primary).exec();
        if (existing) {
            fields.forEach(field => {
                delete json[field];
            });
            const data = Object.assign({}, existing._data, json);
            data._rev = existing._rev;
            existing._data = data;
            await existing.save();
            return existing;
        } else {
            const newDoc = await $this.insert(json);
            return newDoc;
        }
    };
    $this.upsertWithFields = upsertWithFields;
    $this.upsertExcludeFields = upsertExcludeFields;
};
