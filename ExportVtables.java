import ghidra.app.script.GhidraScript;
import ghidra.program.model.listing.*;
import ghidra.program.model.symbol.*;
import ghidra.program.model.address.*;
import ghidra.program.model.mem.*;
import java.io.FileWriter;
import java.io.PrintWriter;
import java.util.*;

public class ExportVtables extends GhidraScript {
    @Override
    public void run() throws Exception {
        String outputPath = getScriptArgs()[0];
        PrintWriter pw = new PrintWriter(new FileWriter(outputPath));

        Memory mem = currentProgram.getMemory();
        SymbolTable st = currentProgram.getSymbolTable();
        FunctionManager fm = currentProgram.getFunctionManager();

        // Find all RTTI Type Descriptors to get class names and vtable locations
        // In MSVC RTTI, the type descriptor string ".?AVClassName@@" is near the vtable
        // Look for vftable symbols
        SymbolIterator symbols = st.getAllSymbols(true);
        while (symbols.hasNext()) {
            Symbol sym = symbols.next();
            String name = sym.getName(true); // get full namespace path
            if (name.contains("vftable") || name.contains("vbtable")) {
                pw.println("//========================================");
                pw.println("// VTABLE: " + name + " at " + sym.getAddress());
                pw.println("//========================================");

                // Read vtable entries (function pointers)
                Address addr = sym.getAddress();
                try {
                    for (int i = 0; i < 80; i++) {
                        Address entryAddr = addr.add(i * 4);
                        int funcPtr = mem.getInt(entryAddr);
                        Address funcAddr = addr.getNewAddress(funcPtr);
                        Function func = fm.getFunctionAt(funcAddr);
                        if (func != null) {
                            pw.println("  [" + i + "] " + funcAddr + " -> " + func.getName());
                        } else {
                            // Check if this looks like a valid code address
                            if (funcPtr >= 0x00401000 && funcPtr < 0x00500000) {
                                pw.println("  [" + i + "] " + funcAddr + " -> (no function)");
                            } else {
                                break; // End of vtable
                            }
                        }
                    }
                } catch (Exception e) {
                    pw.println("  (error reading vtable: " + e.getMessage() + ")");
                }
                pw.println();
            }
        }

        // Also export all named functions (any function with a non-FUN_ name)
        pw.println("//========================================");
        pw.println("// NAMED FUNCTIONS");
        pw.println("//========================================");
        FunctionIterator funcs = fm.getFunctions(true);
        while (funcs.hasNext()) {
            Function func = funcs.next();
            String name = func.getName();
            if (!name.startsWith("FUN_") && !name.startsWith("thunk_") && !name.startsWith("_")) {
                String ns = "";
                if (func.getParentNamespace() != null && !func.getParentNamespace().isGlobal()) {
                    ns = func.getParentNamespace().getName() + "::";
                }
                pw.println(func.getEntryPoint() + " " + ns + name + " " + func.getSignature());
            }
        }

        pw.close();
        println("Exported vtables to " + outputPath);
    }
}
