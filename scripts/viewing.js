WebViewer({
    path: '../lib',
    initialDoc: '../pdfs/Payslips_July_19.pdf',
  }, document.getElementById('viewer'))
  .then(function (instance) {
    const docViewer = instance.docViewer;
    const annotManager = instance.annotManager;
    console.log('Heyyyy', docViewer, annotManager);
    annotManager.on('annotationChanged', function (event, annotations, action) {
      if (action === 'add') {
        console.log('this is a change that added annotations', event);
      } else if (action === 'modify') {
        console.log('this change modified annotations', event);
      } else if (action === 'delete') {
        console.log('there were annotations deleted', event);
      }

      annotations.forEach(function (annot) {
        console.log('annotation page number', annot.PageNumber);
      });
    });

    // document.getElementById('file-picker').onchange = function (e) {
    //   var file = e.target.files[0];
    //   if (file) {
    //     instance.loadDocument(file);
    //   }
    // };

  }).catch(e => console.log(`Error Occured in viewing.js ${e}`));