import ghidra.app.script.GhidraScript;
import ghidra.program.model.data.*;
import ghidra.program.model.listing.*;
import ghidra.program.model.symbol.*;
import java.io.FileWriter;
import java.io.PrintWriter;
import java.util.Iterator;

public class ExportStructs extends GhidraScript {
    @Override
    public void run() throws Exception {
        String outputPath = getScriptArgs()[0];
        PrintWriter pw = new PrintWriter(new FileWriter(outputPath));

        // Export all data types
        DataTypeManager dtm = currentProgram.getDataTypeManager();
        pw.println("//========================================");
        pw.println("// DATA TYPES");
        pw.println("//========================================");
        Iterator<DataType> it = dtm.getAllDataTypes();
        while (it.hasNext()) {
            DataType dt = it.next();
            if (dt instanceof Structure) {
                Structure s = (Structure) dt;
                pw.println("struct " + s.getName() + " { // size: " + s.getLength());
                for (DataTypeComponent comp : s.getComponents()) {
                    pw.println("    " + comp.getDataType().getName() + " " +
                        (comp.getFieldName() != null ? comp.getFieldName() : "field_0x" + Integer.toHexString(comp.getOffset())) +
                        "; // offset: 0x" + Integer.toHexString(comp.getOffset()));
                }
                pw.println("};");
                pw.println();
            }
        }

        // Export string data
        pw.println("//========================================");
        pw.println("// STRING REFERENCES");
        pw.println("//========================================");
        Listing listing = currentProgram.getListing();
        DataIterator dataIt = listing.getDefinedData(true);
        while (dataIt.hasNext()) {
            Data data = dataIt.next();
            if (data.getDataType() instanceof StringDataType ||
                data.getDataType().getName().contains("string") ||
                data.getDataType().getName().contains("unicode")) {
                Object val = data.getValue();
                if (val != null) {
                    String s = val.toString();
                    if (s.length() > 2 && s.length() < 500) {
                        pw.println("// " + data.getAddress() + ": " + s);
                    }
                }
            }
        }

        // Export all named symbols (class names, vtables, etc)
        pw.println();
        pw.println("//========================================");
        pw.println("// CLASS/VTABLE SYMBOLS");
        pw.println("//========================================");
        SymbolTable st = currentProgram.getSymbolTable();
        SymbolIterator symbols = st.getAllSymbols(true);
        while (symbols.hasNext()) {
            Symbol sym = symbols.next();
            String name = sym.getName();
            if (name.contains("vftable") || name.contains("vtable") ||
                name.contains("RTTI") || name.contains("TypeDescriptor") ||
                name.contains("::")) {
                pw.println("// " + sym.getAddress() + " " + sym.getSymbolType() + " " + name);
            }
        }

        pw.close();
        println("Exported data types and symbols to " + outputPath);
    }
}
