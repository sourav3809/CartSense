console.log(Object.keys(process.env).filter(k => k.toLowerCase().includes('firebase') || k.toLowerCase().includes('google') || k.toLowerCase().includes('gcp')));
