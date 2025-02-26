const fs = require('fs');
const axios = require('axios');
const { parseStringPromise, Builder } = require('xml2js');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();


// 🛠️ Načítanie environment premenných
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO = "jurajorlicky/xml-import";
const GITHUB_FILE_PATH = "feed.xml";
const GITHUB_API_URL = `https://api.github.com/repos/${GITHUB_REPO}/contents/${GITHUB_FILE_PATH}`;

// Inicializácia Supabase klienta
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// 🔹 Stiahni XML feed zo súboru alebo z GitHubu
async function fetchXMLFromGitHub() {
    try {
        const response = await axios.get(GITHUB_API_URL, {
            headers: { Authorization: `token ${GITHUB_TOKEN}` }
        });

        const xmlContent = Buffer.from(response.data.content, 'base64').toString('utf-8');
        return { xmlContent, sha: response.data.sha };
    } catch (error) {
        console.error("❌ Chyba pri sťahovaní XML:", error.response?.data || error.message);
        return null;
    }
}

// 🔹 Načíta dáta z Supabase
async function fetchPricesFromSupabase() {
    const { data, error } = await supabase
        .from("product_price_view")
        .select("size, final_price, final_status");

    if (error) {
        console.error("❌ Chyba pri načítaní dát zo Supabase:", error);
        return null;
    }

    return data.reduce((acc, row) => {
        acc[row.size] = { price: row.final_price, status: row.final_status };
        return acc;
    }, {});
}

// 🔹 Aktualizuje ceny v XML
async function updateXML(xmlContent, priceMap) {
    const parsedXML = await parseStringPromise(xmlContent);

    parsedXML.SHOP.SHOPITEM.forEach(item => {
        if (item.VARIANTS && item.VARIANTS[0].VARIANT) {
            item.VARIANTS[0].VARIANT.forEach(variant => {
                const size = variant.PARAMETERS[0].PARAMETER[0].VALUE[0];

                if (priceMap[size]) {
                    variant.PRICE_VAT[0] = String(priceMap[size].price);
                    variant.AVAILABILITY_OUT_OF_STOCK[0] = priceMap[size].status;
                }
            });
        }
    });

    const builder = new Builder();
    return builder.buildObject(parsedXML);
}

// 🔹 Nahraje XML na GitHub
async function uploadXMLToGitHub(updatedXML, sha) {
    const encodedContent = Buffer.from(updatedXML).toString('base64');

    const updateData = {
        message: "Aktualizácia XML feedu",
        content: encodedContent,
        sha
    };

    try {
        await axios.put(GITHUB_API_URL, updateData, {
            headers: { Authorization: `token ${GITHUB_TOKEN}` }
        });

        console.log("✅ XML feed bol úspešne aktualizovaný na GitHube.");
    } catch (error) {
        console.error("❌ Chyba pri nahrávaní XML na GitHub:", error.response?.data || error.message);
    }
}

// 🔹 Hlavná funkcia
async function main() {
    const xmlData = await fetchXMLFromGitHub();
    if (!xmlData) return;

    const priceMap = await fetchPricesFromSupabase();
    if (!priceMap) return;

    const updatedXML = await updateXML(xmlData.xmlContent, priceMap);
    await uploadXMLToGitHub(updatedXML, xmlData.sha);
}

main();
