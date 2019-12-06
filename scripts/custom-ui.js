// custom-ui.js
CoreControls.setWorkerPath('lib/core');
const _ = require('lodash');
const uniqueFilename = require('unique-filename');
const backEnd = `http://localhost:3000/upload`;
const sampleFile = `http://localhost:8080/pdfs/Payslips_July_19.pdf`;
const uploads = `http://localhost:8080/uploads`;
let globalDocViewer = '';

// PDF - Axis
// X = Left to Right
// Y = Botton to Top

const repeatingZip = (arr1, arr2) => {
    const len_diff = Math.abs(arr1.length - arr2.length);
    const pattern = new Array(len_diff).fill(arr1.length > arr2.length ? arr2 : arr1).flatMap(_ => _);
    return arr1.length > arr2.length ? _.zip(arr1, arr2.concat(pattern)) : _.zip(arr1.concat(pattern), arr2);
};

const zipTextWithCoordinates = textArray => {
    // Input - textArray = [
    //    ["text", text_length],
    //    {x1, y2, x2, y2},
    //    ["text", text_length],
    //    {x1, y2, x2, y2}, ......
    // ]
    const result = [];
    for (let i = 0; i < textArray.length; i += 2) {
        const [text, len] = textArray[i]; // ["text", text_length]
        const {
            x1,
            y1,
            x2,
            y2
        } = textArray[i + 1];
        result.push({
            x1,
            y1,
            x2,
            y2,
            text
        });
    }
    return result;
    // Output = [
    //     {
    //          x1, x2, y1, y2, text
    //     }
    // ]
};

const groupTextsViaYaxis = texts => {
    // Input = [
    //     {
    //          x1, x2, y1, y2, text
    //     }
    // ]
    return _.chain(texts)
        .groupBy("y1")
        .map((v, k) => ({
            y1: Number(k),
            y2: Number(v[0].y2),
            texts: v
        }))
        .sortBy(e => e.y1)
        .reverse()
        .value();
    // Output = [
    //     {
    //         y1, 
    //         y2,
    //         texts: [
    //             {text: "text", x1: "", x2: "", y1: "", y2: ""},
    //             {text: "text", x1: "", x2: "", y1: "", y2: ""},
    //             {text: "text", x1: "", x2: "", y1: "", y2: ""}
    //         ]
    //     }
    // ]
};

const searchClosestIndex = (sortedArray, extracter, x) => {
    // let closest = Infinity;
    let closestDiff = Infinity;
    let closestIndex = 0;
    sortedArray.forEach((e, i) => {
        const currentDiff = Math.abs(x - Number(extracter(e)));
        if (currentDiff < closestDiff) {
            closestDiff = currentDiff;
            // closest = e;
            closestIndex = i;
        }
    });
    return closestIndex;
};

const inBetween = (a, pair) => {
    const [x, y] = pair;
    const [min, max] = [Math.min(x, y), Math.max(x, y)];
    return a >= min && a <= max;
};

const filterRange = (textMap, boxCoordinates) => {
    // boxCoordinates = {x1, y1, x2, y2}
    // (x1, y1) - Bottom Left Corner
    // (x2, y2) - Top Right Corner
    // textMap = [
    //     {
    //         y1, 
    //         y2,
    //         texts: [
    //             {text: "text", x1: "", x2: "", y1: "", y2: ""},
    //             {text: "text", x1: "", x2: "", y1: "", y2: ""},
    //             {text: "text", x1: "", x2: "", y1: "", y2: ""}
    //         ]
    //     }
    // ]
    // _.indexOf(xs, x, true); -- Binary Search
    // _.indexOf(xs, x); -- Normal Search
    const {
        x1,
        y1,
        x2,
        y2
    } = boxCoordinates;
    // Page = List hanging down
    // Page Top => List Left
    // Page Bottom => List Right
    const topLineIndex = searchClosestIndex(textMap, e => e.y2, y2); // Exclude Top Most
    // Possibilities for TopLineIndex
    // y2.UnWanted.y1 - Box.y2     - y2.Wanted.y1 -- Closer to unwanted line
    // y2.UnWanted.y1 -     Box.y2 - y2.Wanted.y1 -- Closer to wanted line
    // -- closest.y1 inBetween (closest.y2, Box.y2) 
    // ? Don't Pick TopLineIndex : Pick TopLineIndex
    const baseLineIndex = searchClosestIndex(textMap, e => e.y1, y1); // Include Bottom Most
    // Possibilities for BaseLineIndex
    // y2.Wanted.y1 - Box.y1     - y2.UnWanted.y1 -- Closer to wanted line
    // y2.Wanted.y1 -     Box.y1 - y2.UnWanted.y1 -- Closer to unwanted line
    // -- closest.y2 inBetween (Box.y1, closest.y1) 
    // ? Don't Pick BaseLineIndex : Pick BaseLineIndex

    // Slice doesn't include last index
    const topLine = textMap[topLineIndex];
    const bottomLine = textMap[baseLineIndex];
    return textMap.slice(
        inBetween(topLine.y1, [topLine.y2, y2]) ? topLineIndex + 1 : topLineIndex,
        inBetween(bottomLine.y2, [bottomLine.y1, y1]) ? baseLineIndex : baseLineIndex + 1);
    // Output = [
    //     {
    //         y1, // Filtered as  
    //         y2,
    //         texts: [
    //             {text: "text", x1: "", x2: "", y1: "", y2: ""},
    //             {text: "text", x1: "", x2: "", y1: "", y2: ""},
    //             {text: "text", x1: "", x2: "", y1: "", y2: ""}
    //         ]
    //     }
    // ]
};

const isLeftLeaning = (left, between, right) => {
    // 20 40 80 - Yes, 40 is left leaning
    // 20 60 80 - No, 60 is right leaning
    return (right - between) >= (between - left);
};

const isRightLeaning = (left, between, right) => {
    return !isLeftLeaning(left, between, right);
};

const decideToTakeWord = (wordLeft, wordRight, boxLeft, boxRight) => {
    // Possibilites of Word Overlapping with Box
    /*  1. Word Fully Inside of Box - Take the word
            X1 - W1 - W2 - X2
        2. Left Overlap - Take the word if more that 50% overlap
            W1 - X1 - W2 - X2
        3. Right Overlap - Take the word if more that 50% overlap
            X1 - W1 - X2 - W2
        4. Left Outside - Don't take the word
            W1 - W2 - X1 - X2
        5. Right Outside - Don't take the word
            X1 - X2 - W1 - W2
        6. Box Fully Inside of Word - Take the word if Box Width is more than Half of Word Width 
            W1 - X1 - X2 - W2
    */
    if (boxLeft <= wordLeft && wordRight <= boxRight) {
        return true;
    } else if (wordLeft <= boxLeft && wordRight <= boxRight) {
        return isLeftLeaning(wordLeft, boxLeft, wordRight);
    } else if (boxLeft <= wordLeft && boxRight <= wordRight) {
        return isRightLeaning(wordLeft, boxRight, wordRight);
    } else if (wordRight <= boxLeft || boxRight <= wordLeft) {
        return false;
    } else { // Box Fully Inside of Word
        const wordWidth = wordRight - wordLeft;
        const boxWidth = boxRight - boxLeft;
        return boxWidth * 2 >= wordWidth;
    }
};

const extractTextFromBox = (textMap, boxCoordinates) => {
    // boxCoordinates = {x1, y1, x2, y2}
    // (x1, y1) - Bottom Left Corner
    // (x2, y2) - Top Right Corner
    // textMap = [
    //     {
    //         y1, 
    //         y2,
    //         texts: [
    //             {text: "text", x1: "", x2: "", y1: "", y2: ""},
    //             {text: "text", x1: "", x2: "", y1: "", y2: ""},
    //             {text: "text", x1: "", x2: "", y1: "", y2: ""}
    //         ]
    //     }
    // ]
    const {
        x1: bx1,
        y1: by1,
        x2: bx2,
        y2: by2
    } = boxCoordinates;
    const filterd = filterRange(textMap, boxCoordinates);
    const result = [];
    filterd.forEach(line => {
        const temp = [];
        line.texts.forEach(word => {
            const {
                text,
                x1,
                x2,
                y1,
                y2
            } = word;
            if (decideToTakeWord(Number(x1), Number(x2), bx1, bx2)) {
                temp.push(text);
            }
        });
        if (temp.length !== 0) {
            result.push(temp);
        }
    });
    return result;
    // Output = ["line1", "line2"];
};

const extractTextFromPage = (doc, pageIndex) => {
    // Accepts 0 based page index
    return new Promise((resolve, reject) => {
        doc.loadPageText(pageIndex, text => {
            const data = [];
            const getTextPositionCallback = quads => {
                // 'quads' will contain an array for each character between the start and end indexes
                const first = quads[0];
                const last = quads[quads.length - 1];
                const normalCorordinates = {
                    'x1': first.x1,
                    'x2': last.x2,
                    'y1': first.y4,
                    'y2': first.y1,
                };
                const x1y1 = doc.getPDFCoordinates(pageIndex, normalCorordinates.x1, normalCorordinates.y1);
                const x2y2 = doc.getPDFCoordinates(pageIndex, normalCorordinates.x2, normalCorordinates.y2);
                const pdfCoordinates = {
                    'x1': x1y1.x,
                    'y1': x1y1.y,
                    'x2': x2y2.x,
                    'y2': x2y2.y,
                };
                data.push(pdfCoordinates);
            };
            const refinedData = text // "FirstName LastName↵ReferenceNumber↵"
                .split('\n') // ["FirstName LastName", "ReferenceNumber", ""]
                .map(s => [s, s.length]) // [["FirstName LastName", 18], ["ReferenceNumber", 15], ["", 0]]
                .reduce((acc, x) => { // [["FirstName LastName", 18], ["ReferenceNumber", 34]]
                    if (x[1] === 0) {
                        return acc;
                    } else if (acc.length === 0) {
                        return [x];
                    } else {
                        acc.push([x[0], acc[acc.length - 1][1] + x[1] + 1]);
                        return acc;
                    }
                }, []);
            refinedData.forEach(x => {
                data.push(x);
                doc.getTextPosition(pageIndex, x[1] - x[0].length, x[1], getTextPositionCallback);
            });
            const textZipped = zipTextWithCoordinates(data);
            if (textZipped === undefined || textZipped === null) {
                reject(`Zipping of text co-ordinates failed.`);
            }
            const textMap = groupTextsViaYaxis(textZipped);
            if (textMap === undefined || textMap === null) {
                reject(`TextMap Construction failed.`);
            }
            resolve(textMap);
        });
    });
};

const renderPDF = (backendType, fileName) => {
    if (globalDocViewer === '') {
        const licenseKey = '';
        const workerTransportPromise = CoreControls.initPDFWorkerTransports(backendType, {}, licenseKey);
        const docViewer = globalDocViewer === '' ? new CoreControls.DocumentViewer() : globalDocViewer;
        globalDocViewer = docViewer;
        const partRetriever = new CoreControls.PartRetrievers.ExternalPdfPartRetriever(fileName);
        docViewer.setScrollViewElement(document.getElementById('scroll-view'));
        docViewer.setViewerElement(document.getElementById('viewer'));
        docViewer.loadAsync(partRetriever, {
            type: 'pdf',
            backendType: backendType,
            workerTransportPromise: workerTransportPromise
        });
        docViewer.setOptions({
            enableAnnotations: true
        });
        setupEventHandlers(docViewer);
        docViewer.on('documentLoaded', () => {
            // enable default tool for text and annotation selection
            docViewer.setToolMode(docViewer.getTool('AnnotationEdit'));
            // const doc = docViewer.getDocument();
            // extractTextFromPage(doc, 0);
        });
    } else {
        const licenseKey = '';
        const workerTransportPromise = CoreControls.initPDFWorkerTransports(backendType, {}, licenseKey);
        const partRetriever = new CoreControls.PartRetrievers.ExternalPdfPartRetriever(fileName);
        globalDocViewer.loadAsync(partRetriever, {
            type: 'pdf',
            backendType: backendType,
            workerTransportPromise: workerTransportPromise
        });
    }
};

const randomFileName = initial => uniqueFilename('', uniqueFilename('', uniqueFilename('', initial)));

const generateExcel = (sheetsData, options) => {
    // sheetsData = [sheet1Data, sheet2Data, sheet3Data]
    // sheet1Data = // [KeyValuePairs(Rows)]
    // [
    //      {Col1: v11, Col2: v12} // Row
    //      {Col1: v21, Col2: v22} // Row
    // ]
    // options = [
    //      {sheetid: "<SheetName>", header: true} // Sheet 1 Info
    //      {sheetid: "<SheetName>", header: true} // Sheet 2 Info
    // ]
    const fileName = randomFileName('excel');
    alasql(`SELECT * INTO XLSX('${fileName}', ?) FROM ?`, [options, sheetsData]);
};

// Ex: typesModal -> ["NI", "String", "Number.2", "Number.4"]
const getChipValues = modal_id => Array.from(document.querySelectorAll(`#${modal_id} .chip`)).map(e => e.innerText.split("\n")[0].split('×')[0].trim());

const fillElements = (fromModal, intoSection, elementType) => {
    $(`#${intoSection}`).empty();
    getChipValues(fromModal).forEach(word => {
        $(`#${intoSection}`).append(`
            <${elementType}> ${word} </${elementType}>
        `);
    });
};

const fillAnnotationModal = (boxCoordinates) => {
    // Requires 3 dropdowns
    // Keywords
    // Types
    // Structures
    $('#annotationBoxCoordinates').html(boxCoordinates);
    fillElements('keyWordsModal', 'keyWordsDropDown', 'option');
    fillElements('typesModal', 'typesDropDown', 'option');
    fillElements('structuresModal', 'structuresDropDown', 'option');
};

const templateItem = (boxCoordinates, keyWord, type, structure) => {
    const item = `
    <div class="editing_template_item hover_up_background">
        <div>
            <b>Box: </b> <span>${boxCoordinates}</span>
        </div>
        <div>
            <b>KeyWord: </b> <span>${keyWord}</span>
        </div>
        <div>
            <b>Type: </b> <span>${type}</span>
        </div>
        <div>
            <b>Structure: </b> <span>${structure}</span>
        </div>
    </div>
    `;
    $('#current_template_container').append(item);
};

const getBoxCoordinates = () =>
    Array.from(document.querySelectorAll('#current_template_container>div>div:first-child>span')).map(e => e.innerText).map(s => JSON.parse(`{${s}}`));

const getBoxKeyWords = () => Array.from(document.querySelectorAll('#current_template_container>div>div:nth-child(2)>span')).map(e => e.innerText);

const getBoxTypes = () => Array.from(document.querySelectorAll('#current_template_container>div>div:nth-child(3)>span')).map(e => e.innerText);

const getBoxStructures = () => Array.from(document.querySelectorAll('#current_template_container>div>div:last-child>span')).map(e => e.innerText);

const excelTemplateSheets = () => Array.from(document.querySelectorAll(`[id*="excel_row_cell"] * input`));

const getSheetNames = () => excelTemplateSheets().map(e => e.value);

const getColumnsPerSheet = index => Array.from(document.querySelectorAll(`#excel_row_cell_${index} * select`)).map(e => Array.from(e.options).filter(e => e.selected)).map(e => e[0].value);

const sheetNamesToAlaSqlItems = sheetNames => sheetNames.map(name => ({'sheetid': name, headers: true}));

const getSheetNameAndColumnsInfo = () => {
    const sheetNames = getSheetNames();
    const sheetsCount = excelTemplateSheets().length;
    const res = {};
    for (let i = 0; i < sheetsCount; i++) {
        res[sheetNames[i]] = getColumnsPerSheet(i + 1);
    }
    return res;
};

const typeToRegex = type => {
    // Can accept only 3 kinds of types
    // NI - /^[A-CEGHJ-PR-TW-Z]{1}[A-CEGHJ-NPR-TW-Z]{1}[0-9]{6}[A-DFM]{0,1}$/
    // String - Do Nothing
    // Number.x - /(\d{1,}\.\d{x})/
    if (type === "NI") {
        return /^[A-CEGHJ-PR-TW-Z]{1}[A-CEGHJ-NPR-TW-Z]{1}[0-9]{6}[A-DFM]{0,1}$/;
    } else if (type.match(/^Number\.\d$/)) {
        return new RegExp(`(\\d{1,}\\.\\d{${type.match(/^Number\.(\d)$/)[1]}})`);
    } else {
        throw new Error(`Can only accept "NI", "Number.x" types.`);
    }
};

const separateNumbersWithDecimals = (data, type) => {
    // Assuming this function will be called only with type that have Number.x's to the end
    // data - ["Salary", "1.00 8968.7500", "8968.75"]
    // type - 'String - Number.2 - Number.4 - Number.2'
    // output - ["Salary", "1.00", "8968.7500", "8968.75"]
    const types = type.split(/\s*-\s*/);
    const zippedData = _.zip(types, data);
    const numbers_values = zippedData.filter(arr => arr[0].includes('Number'));
    // [ ["Number.2", "1.00 8968.7500"]
    //   ["Number.4", "8968.75"]
    //   ["Number.2", undefined] ]
    const constantsAtStart = zippedData.filter(arr => ! arr[0].includes('Number')).map(arr => arr[1]); // Ex: ["Salary", "1.00 8968.7500", "8968.75"] => ["Salary"]
    const numbers = numbers_values.map(x => x[1]).join(''); // "1.00 8968.75008968.75"
    const number_types = numbers_values.map(x => x[0]); // ["Number.2", "Number.4", "Number.2"]
    const reg = new RegExp(number_types.map(typeToRegex).map(x => x.source).join('\\s*')); // /(\d{1,}\.\d{2})\s*(\d{1,}\.\d{4})\s*(\d{1,}\.\d{2})/
    const matches = numbers.match(reg);
    // matches can be null : Ex: Parental pay    (no quantity) (no rate) (only total was provided)
    return constantsAtStart.concat(matches ? number_types.map((_, i) => Number(matches[i + 1])) : number_types.map((_, i) => i === number_types.length - 1 ? numbers : 0)); // ["Salary", "1.00", "8968.7500", "8968.75"]
};

const parseDataWrtTypes = (data, type, isSingleLiner) => {
    // The whole point of "types" here is to separate Numbers from each other but not to separate strings (which is impossible)
    // data ::  Payslip Structure Words | Payslip SingleLine [String] | Payslip Grid [String] | [[[ String ]]]
    // For each Words in inner array apply the type & separate them out
    // type - String | NI | Number.x | String - Number.x - Number.x | ...
    // isSingleLiner - true if data is of SingleLined Structure, then filter inner array to [Array:1_length] using the type information
    // isSingleLiner - false if data is Grid Structure, then don't cut data, just parse individual elements in inner array & seperate them
    // If data = [[["JA405129B"]], [["KJ405129C"]]] => [[["JA405129B"], ["KJ405129C"]]]
    // If Overselected the NI numbers to include some extra text them cut that down
    // If data = [[["Paye", "JA405129B"]], [["KJ405129C", "Tax"]]] => [[["JA405129B"]], [["KJ405129C"]]]
    // If data = [[["Salary", "1.00 8968.7500", "8968.75"], ["Car Allowance", "1.00 400.0000", "400.00"], ["Commission", "1.0013942.6600 13942.66"]]] & type = "String - Number.2 - Number.4 - Number.2"
    // => [[["Salary", "1.00", "8968.7500", "8968.75"], ["Car Allowance", "1.00", "400.0000", "400.00"], ["Commission", "1.00", "13942.6600", "13942.66"]]]

    if (isSingleLiner) { 
        if (type === 'String') {
            return data;
        } else if (type.match(/^Number\.\d$/) || type === 'NI') {
            return data.map(payslip => payslip.map(structure => structure.filter(words => words.match(typeToRegex(type)))));
        } else {
            throw new Error(`Unknown type for a single liner.`);
        }
    } else { // Grid
        // If type contains multiple numbers then fuse the numbers
        if (type.split(/\s*-\s*/).filter(e => e.includes('Number')).length > 1) {
            return data.map(payslip => payslip.map(structure => separateNumbersWithDecimals(structure, type)));
        }
        // Return data if simple data type
        return data;
    }
};

const seperateSingleLinersFromMultiLiners = (columns, keyWords, structures) => {
    // columns = [Col1, Col2, Col2] => Output = [[Col1, Col2], [Col3]]
    // columns = ["NI Number", "Earnings", "Deductions"] => Output = [["NI Number"], ["Earnings", "Deductions"]]
    return [columns.filter(t => structures[keyWords.indexOf(t)].includes('Single')), columns.filter(t => ! structures[keyWords.indexOf(t)].includes('Single'))];
};

const evenOutMultiLiners = (multiLinerFilteredData, maxLengthOfMultiLiners) => {
    return multiLinerFilteredData.map(grid_data => {
        if (grid_data.length === maxLengthOfMultiLiners) {
            return grid_data;
        } else {
            // Fill empty
            if (grid_data.length === 0) {
                return new Array(maxLengthOfMultiLiners).fill([{}]);
            } else {
                return grid_data.concat(new Array(maxLengthOfMultiLiners - grid_data.length).fill(Object.keys(grid_data[0]).reduce((acc, key) => {acc[key] = ""; return acc;}, {})));
            }
        }
    });
};

const fuseSingleLinersAndMultiLiners = (singleLiner_data, multiLiner_data) => {
    // singleLiner_data = [{v11, v12, pageNo: 0}, {v21, v22, pageNo: 1}]
    // multiLiner_data = [ [{x11, x12, pageNo: 0}, {x21, x22, pageNo: 0}, {x31, x32, pageNo: 1}], [{y11, y12, pageNo: 0}, {y21, y22, pageNo: 1}, {y31, y32, pageNo: 1}] ]
    if (singleLiner_data.length === 0) {
        // Even the multiLiners & merge them
        const maxPageNumber = _.max(multiLiner_data.map(grid_data => grid_data[grid_data.length - 1]['page'])); // max page number from all of multiliner data
        const res = [];
        for(let pageNo = 0; pageNo <= maxPageNumber; pageNo++) {
            const multiLinerFilteredData = multiLiner_data.map(grid_data => grid_data.filter(obj => obj['page'] === pageNo));
            const maxLengthOfMultiLiners = _.max(multiLinerFilteredData.map(x => x.length)); 
            // Ex: NI (1), Full Name (1), Earnings (5), Deductions (7), => We need 7 rows in the Excel, Remaining Earnings will be empty & NI, Full Name are repeated
            const multiLinerEvenedData = evenOutMultiLiners(multiLinerFilteredData, maxLengthOfMultiLiners);
            // console.log(multiLinerEvenedData);
            for (let index = 0; index < maxLengthOfMultiLiners; index++) {
                res.push(_.assign({}, ...(multiLinerEvenedData.map(grid_data => _.omit(grid_data[index], 'page')))));
            }
        }
        return res;
    } else if (multiLiner_data.map(grid_data => grid_data.length).reduce((acc, x) => acc + x, 0) === 0) {
        return singleLiner_data.map(obj => _.omit(obj, 'page'));
    } else {
        const res = [];
        singleLiner_data.forEach(singleMerge => {
            // singleMerge - {v11, v12, pageNo: 0}
            const pageNo = singleMerge['page'];
            const otherValues = _.omit(singleMerge, 'page');
            // multiLiner_data - [ [{x11, x12, pageNo: 0}, {x21, x22, pageNo: 0}, {x31, x32, pageNo: 1}], [{y11, y12, pageNo: 0}, {y21, y22, pageNo: 1}, {y31, y32, pageNo: 1}] ]
            const multiLinerFilteredData = multiLiner_data.map(grid_data => grid_data.filter(obj => obj['page'] === pageNo));
            const maxLengthOfMultiLiners = _.max(multiLinerFilteredData.map(x => x.length)); 
            // Ex: NI (1), Full Name (1), Earnings (5), Deductions (7), => We need 7 rows in the Excel, Remaining Earnings will be empty & NI, Full Name are repeated
            const multiLinerEvenedData = evenOutMultiLiners(multiLinerFilteredData, maxLengthOfMultiLiners);
            // console.log(multiLinerEvenedData);
            const repeatedSingleLiners = new Array(maxLengthOfMultiLiners).fill(otherValues);
            repeatedSingleLiners.forEach((singleLinerMerge, index) => {
                res.push(_.assign({}, singleLinerMerge, ...(multiLinerEvenedData.map(grid_data => _.omit(grid_data[index], 'page')))));
            });
        });
        return res;
    }
};

const packColumnsWrtStructure = (data, keyWords, structures, excel_template) => {
    // data - {'NI Number': [['a'], ['b']], 'Deductions': [[['r', 'q', 't']], [['r', 'q', 't']]]}
    // data.value :: Payslip Structure Words | Payslip SingleLine [String] | Payslip Grid [String] | [[[ String ]]]
    // keyWords - ["NI Number", "Deductions"]
    // structures - ["SingleLine", "Grid"]
    // excelTemplate - {'NI Info': ["NI Number"], 'Deductions': ["NI Number", "Deductions"]}
    // output - [[{'NI': 'a'}, {'NI', 'b'}], [{'NI': 'a', 'rate': 'r', 'quantity': 'q', 'total': 't'}, {'NI': 'b', 'rate': 'r', 'quantity': 'q', 'total': 't'}]]
    const sheets = [];
    for (const sheet in excel_template) {
        // Push array of objects - Rows of Column:Value
        // sheet -> ex: "NI Info", 
        const columns = excel_template[sheet]; // ex: ["NI Number"]
        const [singleLiners, multiLiners] = seperateSingleLinersFromMultiLiners(columns, keyWords, structures);
        const singleLiner_data = []; // [{v11, v12, pageNo: 0}, {v21, v22, pageNo: 1}]
        const multiLiner_data = new Array(multiLiners.length).fill([]); // [ [{x11, x12, pageNo: 0}, {x21, x22, pageNo: 0}, {x31, x32, pageNo: 1}], [{y11, y12, pageNo: 0}, {y21, y22, pageNo: 1}, {y31, y32, pageNo: 1}] ] 
        singleLiners.map(column => data[column]).forEach((payslipsData, index) => {
            payslipsData.forEach((payslip, pIndex) => {
                for (const structure of payslip) {
                    for (const word of structure) {
                        if (singleLiner_data[pIndex]) {
                            singleLiner_data[pIndex][columns[index]] = word;
                        } else {
                            singleLiner_data.push(({[columns[index]]: word, 'page': pIndex}));
                        }
                    }
                }
            });
        });

        multiLiners.map(column => data[column]).forEach((payslipsData, index) => {
            const sheetData = [];
            const fake_column_names = [];
            payslipsData.forEach((payslip, pIndex) => {
                for (const structure of payslip) { // structure - ["Salary", "1.00", "3916.6700", "3916.67"]
                    if (fake_column_names.length === 0) {
                        structure.map(_ => uniqueFilename('', 'Col')).forEach(c => fake_column_names.push(c));
                    }
                    sheetData.push(structure.reduce((acc, word, i) => {acc[fake_column_names[i]] = word; return acc;}, {'page': pIndex}));
                }
            });
            multiLiner_data[index] = sheetData;
        });

        sheets.push(fuseSingleLinersAndMultiLiners(singleLiner_data, multiLiner_data));
    }
    // console.log(sheets);
    return sheets;
};

const fuseDataWithExcelTemplate = (data, keyWords, types, structures, excel_template) => {
    // Hoping users will have unique keywords for each annoation they selected
    // and hence we can fetch the proper types & structures using keyWords index
    // data - {"keyWord": ["...", "...", "..."], "keyWord": ["...", "..."]}
    // data.value :: Payslip Structure Words | Payslip SingleLine [String] | Payslip Grid [String] | [[[ String ]]]
    /*
    for(payslip in data) {
        for (structure in payslip) {
            for (word in structure) {

            }
        }
    }
    */ 
    // keyWords - ["NI Number", "Deductions"]
    // types - ["NI", "String - Number.2"]
    // structures - ["SingleLine", "MultiLine", "Key Value", "Grid"]
    // excelTemplate - {'Sheet1': [KeyWord1, KeyWord2], 'Sheet2': [KeyWord1]}
    // output - [[Sheet1Data], [Sheet2Data], ...]
    const parsed_data = {};
    for (const keyWord in data) {
        const index = keyWords.indexOf(keyWord);
        // data[keyWord] - [[["Salary", "1.00 8968.7500", "8968.75"], ["Car Allowance", "1.00 400.0000", "400.00"], ["Commission", "1.0013942.6600 13942.66"]]]
        parsed_data[keyWord] = parseDataWrtTypes(data[keyWord], types[index], structures[index].includes('Single'));
    }
    return packColumnsWrtStructure(parsed_data, keyWords, structures, excel_template);
};

// setup event handlers for the header
const setupEventHandlers = docViewer => {
    document.getElementById('zoom-in-button').addEventListener('click', () => {
        docViewer.zoomTo(docViewer.getZoom() + 0.25);
    });

    document.getElementById('zoom-out-button').addEventListener('click', () => {
        docViewer.zoomTo(docViewer.getZoom() - 0.25);
    });

    document.getElementById('create-rectangle').addEventListener('click', () => {
        docViewer.setToolMode(docViewer.getTool('AnnotationCreateRectangle'));
    });

    document.getElementById('select').addEventListener('click', () => {
        docViewer.setToolMode(docViewer.getTool('AnnotationEdit'));
    });

    document.getElementById('upload').addEventListener('change', function () {
        const file = this.files[0];
        if (file) {
            const formData = new FormData();
            formData.append("file", file);
            fetch(backEnd, {method: "POST", body: formData}).then(res => {
                res.json().then(data => {
                    console.log(data);
                    /*
                    {   
                        fieldname: 'file',
                        originalname: '1.pdf',
                        encoding: '7bit',
                        mimetype: 'application/pdf',
                        destination: './pdfs/uploads',
                        filename: 'file-1575606532817.pdf',
                        path: 'pdfs\\uploads\\file-1575606532817.pdf',
                        size: 222613 
                    }
                    */
                    CoreControls.getDefaultPdfBackendType().then(backendType => {
                        renderPDF(backendType, `${uploads}/${data.filename}`);
                    });
                });
            })
        }
    });

    document.getElementById('keyWords').addEventListener('click', () => {
        const modal = document.getElementById("keyWordsModal");
        modal.style.display = "block";
        // When the user clicks anywhere outside of the modal, close it
        window.onclick = function (event) {
            if (event.target == modal) {
                modal.style.display = "none";
            }
        };
    });

    document.getElementById('types').addEventListener('click', () => {
        const modal = document.getElementById("typesModal");
        modal.style.display = "block";
        // When the user clicks anywhere outside of the modal, close it
        window.onclick = function (event) {
            if (event.target == modal) {
                modal.style.display = "none";
            }
        };
    });

    document.getElementById('structures').addEventListener('click', () => {
        const modal = document.getElementById("structuresModal");
        modal.style.display = "block";
        // When the user clicks anywhere outside of the modal, close it
        window.onclick = function (event) {
            if (event.target == modal) {
                modal.style.display = "none";
            }
        };
    });

    // Insert new chip
    $("#keyWords-chip-input").keyup(function (event) {
        const data = this.value;
        if (event.keyCode === 13) {
            //alert(data);
            $('<div class="chip"> ' + data + ' <span class="closebtn" >&times;</span></div>').insertBefore(this);
            $(this).val(null);
        }
    });

    $("#types-chip-input").keyup(function (event) {
        const data = this.value;
        if (event.keyCode === 13) {
            //alert(data);
            $('<div class="chip"> ' + data + ' <span class="closebtn" >&times;</span></div>').insertBefore(this);
            $(this).val(null);
        }
    });

    $("#structures-chip-input").keyup(function (event) {
        const data = this.value;
        if (event.keyCode === 13) {
            //alert(data);
            $('<div class="chip"> ' + data + ' <span class="closebtn" >&times;</span></div>').insertBefore(this);
            $(this).val(null);
        }
    });

    // Remove chip
    $(document).on('click', '.closebtn', function () {
        //alert('test');
        $(this).parent().remove();
    });

    document.getElementById('annotationSave').addEventListener('click', () => {
        // Fetch the Current AnnotationModal boxCoordinates, keyWord, type, structure
        const boxCoordinates = $('#annotationBoxCoordinates').html();
        const keyWord = Array.from($('#keyWordsDropDown').children()).filter(x => x.selected)[0].value;
        const type = Array.from($('#typesDropDown').children()).filter(x => x.selected)[0].value;
        const structure = Array.from($('#structuresDropDown').children()).filter(x => x.selected)[0].value;
        templateItem(boxCoordinates, keyWord, type, structure);

        // After save close the popup
        const modal = document.getElementById("annotationModal");
        modal.style.display = "none";
    });

    document.getElementById('createExcelTemplate').addEventListener('click', () => {
        const modal = document.getElementById("excelTemplateModal");
        modal.style.display = "block";
        // When the user clicks anywhere outside of the modal, close it
        window.onclick = function (event) {
            if (event.target == modal) {
                modal.style.display = "none";
            }
        };
    });

    document.getElementById('add_sheet').addEventListener('click', () => {
        const keyWords = getChipValues('keyWordsModal').map(k => `<option> ${k} </option>`).join('\n');
        const index = $('#excel_sheets_container').children().length + 1;
        const html  = 
        `<div id="excel_row_cell_${index}" class="excel_column_design hover_up_background margin_top_20px">
            <div class="excel_row_design_space_evenly">
                <div class="excel_row_design_flex_start">
                    <span class="padding_right_20px">Sheet Name: </span>
                    <input type="text">
                </div>
                <button id="add_column_${index}" class="width_100px">Add Column</button>
            </div>
            <div class="excel_row_design_flex_start padding_left_50px">
                <span class="padding_right_20px"> Column: </span>
                <select>
                    ${keyWords}
                </select>
            </div>
        </div>
        `;
        $('#excel_sheets_container').append(html);
    });

    document.getElementById('excel_sheets_container').addEventListener('click', event => {
        const keyWords = getChipValues('keyWordsModal').map(k => `<option> ${k} </option>`).join('\n');
        if (event.target.id && event.target.id.includes('add_column')) {
            const index = event.target.id.match(/(\d+)/)[0];
            $(`#excel_row_cell_${index}`).append(`
                <div class="excel_row_design_flex_start padding_left_50px">
                    <span class="padding_right_20px"> Column: </span>
                    <select>
                        ${keyWords}
                    </select>
                </div>`
            );
        }
    });

    document.getElementById('clear_sheet').addEventListener('click', () => {
        $('#excel_sheets_container').empty();
    });

    document.getElementById('generateExcel').addEventListener('click', () => {
        const modal = document.getElementById("runProcessModal");
        modal.style.display = "block";
        // When the user clicks anywhere outside of the modal, close it
        window.onclick = function (event) {
            if (event.target == modal) {
                modal.style.display = "none";
            }
        };
    });

    document.getElementById('runProcess').addEventListener('click', () => {
        // Generate Excel Sheet
        const data = {};
        const promises = [];
        // console.log(excelTemplateSheets().length);
        if (excelTemplateSheets().length > 0) {
            const doc = docViewer.getDocument();
            const pageCount = doc.getPageCount();
            const coordinates = getBoxCoordinates();
            const keyWords = getBoxKeyWords();
            const types = getBoxTypes(); // How to read the extracted data from PDF
            const structures = getBoxStructures(); // How to Port them to Excel, map or flatmap, ex: Every earning will have one NI, when we put NI & Earnings side by side as excel columns
            const sheetNames = getSheetNames();
            const excel_template = getSheetNameAndColumnsInfo(); // {'Sheet1': [Col1, Col2], 'Sheet2': [Col1]}
            for (let i = 0; i < pageCount; i++) {
                promises.push(extractTextFromPage(doc, i).then(textMap => {
                    // console.log(textMap);
                    coordinates.forEach( ({x1, y1, x2, y2}, j) => {
                        // Extracting data is totally based on annotations drawn
                        const temp = extractTextFromBox(textMap, { x1, y1, x2, y2});
                        if (data[keyWords[j]]) {
                            data[keyWords[j]].push(temp);
                        } else {
                            data[keyWords[j]] = [temp];
                        }
                    });
                }));
            }
            Promise.all(promises).then(() => {
                console.log('data\n', data);
                generateExcel(fuseDataWithExcelTemplate(data, keyWords, types, structures, excel_template), sheetNamesToAlaSqlItems(sheetNames));
            });
        }
    });

    // const annotationChangeContainer = document.getElementById('annotation-change');

    const annotManager = docViewer.getAnnotationManager();
    annotManager.on('annotationChanged', (e, annotations, action) => {
        // annotationChangeContainer.textContent = action + ' ' + annotations.length;
        if (annotations.length === 1 && annotations[0].Subject === 'Rectangle' && action === 'add') {
            // console.log('this is a change that added annotations', event);
            console.log(852, 'Add Annotation is being called', annotations, action);
            const doc = docViewer.getDocument();
            annotations.forEach(annotation => {
                const pageIndex = annotation.getPageNumber() - 1;
                const bottomLeft = doc.getPDFCoordinates(pageIndex, annotation.getLeft(), annotation.getBottom());
                const [x1, y1] = [bottomLeft.x, bottomLeft.y];
                const topRight = doc.getPDFCoordinates(pageIndex, annotation.getRight(), annotation.getTop());
                const [x2, y2] = [topRight.x, topRight.y];

                fillAnnotationModal(`"x1": ${x1}, "y1": ${y1}, "x2": ${x2}, "y2": ${y2}`);
                const modal = document.getElementById("annotationModal");
                modal.style.display = "block";
                // When the user clicks anywhere outside of the modal, close it
                window.onclick = function (event) {
                    if (event.target == modal) {
                        modal.style.display = "none";
                    }
                };
            });
        } else if (action === 'modify') {
            console.log('this change modified annotations', event);
        } else if (action === 'delete') {
            console.log('there were annotations deleted', event);
        }
    });
};

// Main - First Run
CoreControls.getDefaultPdfBackendType().then(backendType => {
    // console.log(backendType); // ems
    // const docViewer = globalDocViewer === '' ? new CoreControls.DocumentViewer() : globalDocViewer;
    // setupEventHandlers(docViewer);
    // renderPDF(backendType, '../pdfs/Payslips_July_19.pdf');
    renderPDF(backendType, sampleFile);
});
