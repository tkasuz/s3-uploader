export const mockFile = (size: number, fileName: string): File => {
    let text = ""
    for (var i = 0; i < size; i++) {
        text += "a";
    }
    const file = new File([text], fileName);
    Object.defineProperty(file, 'size', { value: size });
    return file;
};