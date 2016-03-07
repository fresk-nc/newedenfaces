const xml2js = require('xml2js');

module.exports = function(xmlString) {
    return new Promise((resolve, reject) => {
        xml2js.parseString(xmlString, (err, result) => {
            if (err) {
                reject();
            } else {
                const root = Object.keys(result)[0];

                resolve(result[root]);
            }
        });
    });
};
